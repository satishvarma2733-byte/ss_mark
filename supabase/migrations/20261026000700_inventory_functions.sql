-- M2.4 inventory and pricing engine (docs/02 s.4, docs/07 s.2-5).
-- Lock order for every inventory mutation: venue row, then resource rows in sorted id order, then booking rows.
-- The deadline clock is clock_timestamp() sampled AFTER locks are held (never transaction-start now()).

-- True when [p_start, p_end) fits inside one opening period, evaluated in venue-local time (overnight-aware).
create or replace function app.within_opening_hours(
  p_venue_id uuid, p_schedule_version integer, p_timezone text, p_start timestamptz, p_end timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.opening_periods op
    cross join lateral (
      select (p_start at time zone p_timezone) as local_start, (p_end at time zone p_timezone) as local_end
    ) l
    cross join lateral (values (l.local_start::date), (l.local_start::date - 1)) as d (day)
    where op.venue_id = p_venue_id
      and op.schedule_version = p_schedule_version
      and op.weekday = extract(dow from d.day)::integer
      and d.day + op.opens_local <= l.local_start
      and l.local_end <= d.day + op.closes_local
                         + case when op.closes_next_day then interval '1 day' else interval '0 days' end
  );
$$;

-- Shared quote/hold validation. Raises a domain error; returns nothing on success.
create or replace function app.validate_slot(
  p_venue public.venues,
  p_resource public.resources,
  p_policy public.venue_policies,
  p_start timestamptz,
  p_end timestamptz,
  p_party_size integer,
  p_now timestamptz
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_minutes numeric := extract(epoch from (p_end - p_start)) / 60;
  v_local timestamp := p_start at time zone p_venue.timezone;
begin
  if p_venue.status <> 'PUBLISHED' then
    perform app.fail('NOT_FOUND');
  end if;
  if p_resource.status <> 'ACTIVE' or p_resource.operational_state = 'OUT_OF_SERVICE' then
    perform app.fail('SLOT_UNAVAILABLE', jsonb_build_object('reason', 'resource_unavailable'));
  end if;
  if p_party_size is null or p_party_size < 1 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'party_size'));
  end if;
  if p_party_size > p_resource.capacity then
    perform app.fail('PARTY_TOO_LARGE', jsonb_build_object('capacity', p_resource.capacity));
  end if;
  if v_minutes <> trunc(v_minutes)
     or v_minutes < p_policy.minimum_minutes
     or v_minutes > p_policy.maximum_minutes
     or v_minutes::integer % p_policy.increment_minutes <> 0 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object(
      'field', 'duration_minutes',
      'minimum_minutes', p_policy.minimum_minutes,
      'maximum_minutes', p_policy.maximum_minutes,
      'increment_minutes', p_policy.increment_minutes));
  end if;
  if extract(second from v_local) <> 0
     or (extract(hour from v_local) * 60 + extract(minute from v_local))::integer % p_policy.increment_minutes <> 0 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object(
      'field', 'start_at', 'reason', 'grid', 'increment_minutes', p_policy.increment_minutes));
  end if;
  if p_start < p_now + make_interval(mins => p_policy.lead_minutes) then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object(
      'field', 'start_at', 'reason', 'lead_time', 'lead_minutes', p_policy.lead_minutes));
  end if;
  if p_start > p_now + make_interval(days => p_policy.max_horizon_days) then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object(
      'field', 'start_at', 'reason', 'horizon', 'max_horizon_days', p_policy.max_horizon_days));
  end if;
  -- The cleaning buffer must also fit inside opening hours (docs/02 s.4).
  if not app.within_opening_hours(p_venue.id, p_venue.active_schedule_version, p_venue.timezone,
                                  p_start, p_end + make_interval(mins => p_policy.buffer_minutes)) then
    perform app.fail('OUTSIDE_HOURS');
  end if;
end;
$$;

-- POST /quotes. Server pricing only; advisory, creates no inventory commitment.
create or replace function app.create_quote(
  p_venue_id uuid, p_resource_id uuid, p_start_at timestamptz, p_duration_minutes integer, p_party_size integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_now timestamptz := clock_timestamp();
  v_venue public.venues;
  v_resource public.resources;
  v_policy public.venue_policies;
  v_rate public.resource_rates;
  v_fee public.fee_configurations;
  v_end timestamptz;
  v_base bigint;
  v_total bigint;
  v_price jsonb;
  v_quote public.quotes;
begin
  if p_start_at is null then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'start_at'));
  end if;
  if p_duration_minutes is null or p_duration_minutes <= 0 or p_duration_minutes > 1440 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'duration_minutes'));
  end if;

  select * into v_venue from public.venues where id = p_venue_id and status = 'PUBLISHED';
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  select * into v_resource from public.resources where id = p_resource_id and venue_id = v_venue.id;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  select * into v_policy from public.venue_policies where id = v_venue.active_policy_id and status = 'PUBLISHED';
  if not found then
    perform app.fail('POLICY_NOT_CONFIGURED', jsonb_build_object('field', 'policy'));
  end if;

  v_end := p_start_at + make_interval(mins => p_duration_minutes);
  perform app.validate_slot(v_venue, v_resource, v_policy, p_start_at, v_end, p_party_size, v_now);

  -- Advisory availability. The hold re-checks under locks and the exclusion constraint has the final word.
  if exists (
    select 1 from public.inventory_claims c
    where c.resource_id = v_resource.id
      and c.active
      and (c.expires_at is null or c.expires_at > v_now)
      and c.blocked_range && tstzrange(p_start_at, v_end + make_interval(mins => v_policy.buffer_minutes), '[)')
  ) then
    perform app.fail('SLOT_UNAVAILABLE');
  end if;

  -- The rate in effect at the requested service start (docs/07 s.4).
  select r.* into v_rate
  from public.resource_rates r
  where r.resource_id = v_resource.id
    and r.effective_from <= p_start_at
    and (r.effective_to is null or p_start_at < r.effective_to);
  if not found then
    perform app.fail('POLICY_NOT_CONFIGURED', jsonb_build_object('field', 'rate'));
  end if;
  select f.* into v_fee
  from public.fee_configurations f
  where f.config_version = v_rate.fee_config_version and f.status = 'APPROVED' and f.effective_from <= p_start_at;
  if not found then
    perform app.fail('POLICY_NOT_CONFIGURED', jsonb_build_object('field', 'fee_configuration'));
  end if;
  -- No tax rate is approved (decision register D04). Fail closed rather than invent one.
  if jsonb_array_length(v_fee.tax_rules) > 0 then
    perform app.fail('POLICY_NOT_CONFIGURED', jsonb_build_object('field', 'tax_rules'));
  end if;

  v_base := app.div_half_up(v_rate.hourly_paise * p_duration_minutes, 60);
  v_total := v_base + v_fee.customer_fee_paise;
  v_price := jsonb_build_object(
    'schema', 'price.v1',
    'currency', 'INR',
    'base_paise', v_base,
    'service_fee_paise', v_fee.customer_fee_paise,
    'tax_lines', '[]'::jsonb,
    'discount_paise', 0,
    'total_paise', v_total,
    'hourly_paise', v_rate.hourly_paise,
    'duration_minutes', p_duration_minutes,
    'rate_version', v_rate.rate_version,
    'fee_config_version', v_fee.config_version,
    'commission_bps', v_fee.commission_bps,
    'platform_fixed_paise', v_fee.platform_fixed_paise,
    'rounding_rule', v_fee.rounding_rule,
    'synthetic', v_fee.is_synthetic);

  insert into public.quotes (
    customer_id, venue_id, resource_id, start_at, end_at, party_size, price_snapshot, policy_snapshot,
    policy_id, policy_hash, rate_version, total_paise, expires_at
  ) values (
    v_actor, v_venue.id, v_resource.id, p_start_at, v_end, p_party_size, v_price, app.policy_snapshot(v_policy),
    v_policy.id, v_policy.content_hash, v_rate.rate_version, v_total,
    v_now + make_interval(mins => v_policy.quote_ttl_minutes)
  ) returning * into v_quote;

  return jsonb_build_object(
    'quote_id', v_quote.id,
    'venue_id', v_venue.id,
    'resource_id', v_resource.id,
    'start_at', v_quote.start_at,
    'end_at', v_quote.end_at,
    'party_size', v_quote.party_size,
    'expires_at', v_quote.expires_at,
    'price_snapshot', v_quote.price_snapshot,
    'policy_snapshot', v_quote.policy_snapshot,
    'policy_hash', v_quote.policy_hash,
    'venue_timezone', v_venue.timezone);
end;
$$;

-- Expires due holds on one resource. Caller must already hold the venue and resource locks.
create or replace function app.expire_resource_holds(p_resource_id uuid, p_now timestamptz)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer := 0;
  b record;
begin
  for b in
    select id, status from public.bookings
    where resource_id = p_resource_id
      and status in ('HOLD', 'PENDING_PAYMENT')
      and hold_expires_at <= p_now
    order by id
    for update
  loop
    update public.bookings set status = 'EXPIRED', expired_at = p_now where id = b.id;
    update public.inventory_claims set active = false, released_at = p_now
      where booking_id = b.id and kind = 'BOOKING' and active;
    insert into public.booking_events (booking_id, event_type, from_status, to_status, reason_code, business_key)
      values (b.id, 'HOLD_EXPIRED', b.status, 'EXPIRED', 'HOLD_DEADLINE', 'booking:' || b.id || ':expired');
    perform app.enqueue_job('booking:' || b.id || ':hold_expired', 'booking.hold_expired',
                            jsonb_build_object('booking_id', b.id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- POST /booking-holds. Atomic: locks, deadline sampling, revalidation, booking + claim insert, event.
create or replace function app.create_booking_hold(
  p_quote_id uuid, p_accepted_policy_hash text, p_expected_total_paise bigint, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_terms text;
  v_quote public.quotes;
  v_venue public.venues;
  v_resource public.resources;
  v_policy public.venue_policies;
  v_rate_version integer;
  v_now timestamptz;
  v_booking public.bookings;
begin
  select terms_version into v_terms from public.profiles where id = v_actor;
  if v_terms is null then
    perform app.fail('POLICY_NOT_ACCEPTED', jsonb_build_object('field', 'terms'));
  end if;

  select * into v_quote from public.quotes where id = p_quote_id and customer_id = v_actor;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;

  -- Lock order: venue -> resource -> quote/booking rows.
  select * into v_venue from public.venues where id = v_quote.venue_id for update;
  select * into v_resource from public.resources where id = v_quote.resource_id and venue_id = v_venue.id for update;
  select * into v_quote from public.quotes where id = p_quote_id for update;
  v_now := clock_timestamp();

  -- Expire due holds in the same lock path before checking overlap.
  perform app.expire_resource_holds(v_resource.id, v_now);

  if v_quote.status = 'USED' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'quote_already_used'));
  end if;
  if v_quote.status <> 'OPEN' or v_quote.expires_at <= v_now then
    perform app.fail('QUOTE_EXPIRED');
  end if;
  if p_accepted_policy_hash is distinct from v_quote.policy_hash then
    perform app.fail('POLICY_NOT_ACCEPTED', jsonb_build_object('field', 'accepted_policy_hash'));
  end if;
  if p_expected_total_paise is distinct from v_quote.total_paise then
    perform app.fail('QUOTE_CHANGED', jsonb_build_object('field', 'expected_quote_total_paise'));
  end if;
  if v_venue.status <> 'PUBLISHED' then
    perform app.fail('NOT_FOUND');
  end if;
  if v_venue.active_policy_id is distinct from v_quote.policy_id then
    perform app.fail('QUOTE_CHANGED', jsonb_build_object('reason', 'policy_changed'));
  end if;
  select * into v_policy from public.venue_policies where id = v_quote.policy_id;

  select r.rate_version into v_rate_version
  from public.resource_rates r
  join public.fee_configurations f on f.config_version = r.fee_config_version and f.status = 'APPROVED'
  where r.resource_id = v_resource.id
    and r.effective_from <= v_quote.start_at
    and (r.effective_to is null or v_quote.start_at < r.effective_to);
  if v_rate_version is distinct from v_quote.rate_version then
    perform app.fail('QUOTE_CHANGED', jsonb_build_object('reason', 'rate_changed'));
  end if;

  perform app.validate_slot(v_venue, v_resource, v_policy, v_quote.start_at, v_quote.end_at, v_quote.party_size, v_now);

  insert into public.bookings (
    customer_id, venue_id, resource_id, quote_id, start_at, end_at, party_size, status, hold_expires_at,
    price_snapshot, policy_snapshot, accepted_policy_hash, accepted_at, total_paise
  ) values (
    v_actor, v_venue.id, v_resource.id, v_quote.id, v_quote.start_at, v_quote.end_at, v_quote.party_size, 'HOLD',
    v_now + make_interval(mins => v_policy.hold_minutes),
    v_quote.price_snapshot, v_quote.policy_snapshot, v_quote.policy_hash, v_now, v_quote.total_paise
  ) returning * into v_booking;

  begin
    insert into public.inventory_claims (venue_id, resource_id, booking_id, kind, blocked_range, active, expires_at, created_by)
    values (
      v_venue.id, v_resource.id, v_booking.id, 'BOOKING',
      tstzrange(v_quote.start_at, v_quote.end_at + make_interval(mins => v_policy.buffer_minutes), '[)'),
      true, v_booking.hold_expires_at, v_actor
    );
  exception when exclusion_violation then
    perform app.fail('SLOT_UNAVAILABLE');
  end;

  update public.quotes set status = 'USED' where id = v_quote.id;
  insert into public.booking_events (booking_id, actor_id, event_type, from_status, to_status, request_id, safe_metadata)
    values (v_booking.id, v_actor, 'HOLD_CREATED', null, 'HOLD', p_request_id,
            jsonb_build_object('total_paise', v_booking.total_paise, 'policy_hash', v_booking.accepted_policy_hash));

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'public_ref', v_booking.public_ref,
    'status', v_booking.status,
    'hold_expires_at', v_booking.hold_expires_at,
    'version', v_booking.version,
    'amount_paise', v_booking.total_paise,
    'currency', v_booking.currency);
end;
$$;

-- Customer abandons an unpaid hold. Releases the claim; payments arrive in M3.
create or replace function app.cancel_hold(p_booking_id uuid, p_expected_version integer, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_booking public.bookings;
  v_now timestamptz;
begin
  select * into v_booking from public.bookings where id = p_booking_id and customer_id = v_actor;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  perform 1 from public.venues where id = v_booking.venue_id for update;
  perform 1 from public.resources where id = v_booking.resource_id for update;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  v_now := clock_timestamp();

  if v_booking.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_booking.version, 'status', v_booking.status));
  end if;
  if v_booking.status not in ('HOLD', 'PENDING_PAYMENT') then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_booking.status));
  end if;

  update public.bookings set status = 'CANCELLED', cancelled_at = v_now, cancel_reason = 'CUSTOMER_ABANDONED'
    where id = v_booking.id returning * into v_booking;
  update public.inventory_claims set active = false, released_at = v_now
    where booking_id = v_booking.id and kind = 'BOOKING' and active;
  insert into public.booking_events (booking_id, actor_id, event_type, from_status, to_status, reason_code, request_id)
    values (v_booking.id, v_actor, 'HOLD_CANCELLED', 'HOLD', 'CANCELLED', 'CUSTOMER_ABANDONED', p_request_id);

  return jsonb_build_object('booking_id', v_booking.id, 'status', v_booking.status, 'version', v_booking.version);
end;
$$;

-- Worker sweep. Venue/resource locks are taken in sorted order, so concurrent sweeps cannot deadlock.
create or replace function app.expire_due_holds(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select distinct b.venue_id, b.resource_id
    from public.bookings b
    where b.status in ('HOLD', 'PENDING_PAYMENT') and b.hold_expires_at <= clock_timestamp()
    order by b.venue_id, b.resource_id
    limit greatest(1, least(p_limit, 500))
  loop
    perform 1 from public.venues where id = r.venue_id for update;
    perform 1 from public.resources where id = r.resource_id for update;
    v_count := v_count + app.expire_resource_holds(r.resource_id, clock_timestamp());
  end loop;
  return v_count;
end;
$$;

-- POST /partner/resources/{id}/closures (manager/owner, MFA). Rejects overlap with any active claim and returns
-- the conflicting references instead of silently cancelling bookings (docs/05, AC-09).
create or replace function app.create_closure(
  p_venue_id uuid, p_resource_ids uuid[], p_start_at timestamptz, p_end_at timestamptz, p_reason text,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_ids uuid[];
  v_now timestamptz;
  v_conflicts jsonb;
  v_closure_ids uuid[];
  v_id uuid;
begin
  if not app.is_venue_member(p_venue_id, array['MANAGER', 'OWNER']) then
    if app.is_venue_member(p_venue_id, array['STAFF']) then
      perform app.fail('FORBIDDEN');
    end if;
    perform app.fail('NOT_FOUND');
  end if;
  perform app.require_aal2();
  if p_start_at is null or p_end_at is null or p_start_at >= p_end_at or p_end_at - p_start_at > interval '31 days' then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'end_at'));
  end if;
  if p_reason is null or char_length(p_reason) not between 3 and 500 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason'));
  end if;

  perform 1 from public.venues where id = p_venue_id for update;
  select array_agg(r.id order by r.id) into v_ids
  from public.resources r
  where r.venue_id = p_venue_id and r.status <> 'RETIRED'
    and (p_resource_ids is null or r.id = any (p_resource_ids));
  if v_ids is null or (p_resource_ids is not null and cardinality(v_ids) <> cardinality(array(select distinct unnest(p_resource_ids)))) then
    perform app.fail('NOT_FOUND', jsonb_build_object('field', 'resource_ids'));
  end if;
  perform 1 from public.resources where id = any (v_ids) order by id for update;
  v_now := clock_timestamp();
  foreach v_id in array v_ids loop
    perform app.expire_resource_holds(v_id, v_now);
  end loop;

  select jsonb_agg(jsonb_build_object(
           'kind', c.kind, 'public_ref', b.public_ref, 'booking_status', b.status, 'resource_label', r.label,
           'starts_at', lower(c.blocked_range), 'ends_at', upper(c.blocked_range))
         order by lower(c.blocked_range))
    into v_conflicts
  from public.inventory_claims c
  join public.resources r on r.id = c.resource_id
  left join public.bookings b on b.id = c.booking_id
  where c.resource_id = any (v_ids) and c.active and c.blocked_range && tstzrange(p_start_at, p_end_at, '[)');
  if v_conflicts is not null then
    perform app.fail('SLOT_UNAVAILABLE', jsonb_build_object('reason', 'closure_conflict', 'conflicts', v_conflicts));
  end if;

  with inserted as (
    insert into public.inventory_claims (venue_id, resource_id, kind, blocked_range, active, reason, created_by)
    select p_venue_id, rid, 'CLOSURE', tstzrange(p_start_at, p_end_at, '[)'), true, p_reason, v_actor
    from unnest(v_ids) as rid
    returning id
  )
  select array_agg(id) into v_closure_ids from inserted;

  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, venue_id, request_id, reason, safe_diff)
  values (v_actor, 'VENUE_MANAGER', 'closure.create', 'venue', p_venue_id, p_venue_id, p_request_id, p_reason,
          jsonb_build_object('resource_count', cardinality(v_ids), 'start_at', p_start_at, 'end_at', p_end_at));

  return jsonb_build_object('closure_ids', to_jsonb(v_closure_ids), 'resource_count', cardinality(v_ids),
                            'start_at', p_start_at, 'end_at', p_end_at);
end;
$$;

grant execute on function
  app.create_quote(uuid, uuid, timestamptz, integer, integer),
  app.create_booking_hold(uuid, text, bigint, uuid),
  app.cancel_hold(uuid, integer, uuid),
  app.create_closure(uuid, uuid[], timestamptz, timestamptz, text, uuid)
  to authenticated;
grant execute on function app.expire_due_holds(integer) to simply_worker;
