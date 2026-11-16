-- M3 discovery, availability, customer projections and staff arrival (docs/07 s.2, 4, 5; docs/03 C01-C09, P06).
-- Search and holds share one rule set: app.slot_problem is used by app.validate_slot (holds/quotes) and by search.

-- Non-raising slot check. Returns {code, detail} for the first problem, or null when the slot is valid.
create or replace function app.slot_problem(
  p_venue public.venues,
  p_resource public.resources,
  p_policy public.venue_policies,
  p_start timestamptz,
  p_end timestamptz,
  p_party_size integer,
  p_now timestamptz
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_minutes numeric := extract(epoch from (p_end - p_start)) / 60;
  v_local timestamp := p_start at time zone p_venue.timezone;
begin
  if p_venue.status <> 'PUBLISHED' then
    return jsonb_build_object('code', 'NOT_FOUND', 'detail', '{}'::jsonb);
  end if;
  if p_resource.status <> 'ACTIVE' or p_resource.operational_state = 'OUT_OF_SERVICE' then
    return jsonb_build_object('code', 'SLOT_UNAVAILABLE', 'detail', jsonb_build_object('reason', 'resource_unavailable'));
  end if;
  if p_party_size is null or p_party_size < 1 then
    return jsonb_build_object('code', 'VALIDATION_FAILED', 'detail', jsonb_build_object('field', 'party_size'));
  end if;
  if p_party_size > p_resource.capacity then
    return jsonb_build_object('code', 'PARTY_TOO_LARGE', 'detail', jsonb_build_object('capacity', p_resource.capacity));
  end if;
  if v_minutes <> trunc(v_minutes)
     or v_minutes < p_policy.minimum_minutes
     or v_minutes > p_policy.maximum_minutes
     or v_minutes::integer % p_policy.increment_minutes <> 0 then
    return jsonb_build_object('code', 'VALIDATION_FAILED', 'detail', jsonb_build_object(
      'field', 'duration_minutes',
      'minimum_minutes', p_policy.minimum_minutes,
      'maximum_minutes', p_policy.maximum_minutes,
      'increment_minutes', p_policy.increment_minutes));
  end if;
  if extract(second from v_local) <> 0
     or (extract(hour from v_local) * 60 + extract(minute from v_local))::integer % p_policy.increment_minutes <> 0 then
    return jsonb_build_object('code', 'VALIDATION_FAILED', 'detail', jsonb_build_object(
      'field', 'start_at', 'reason', 'grid', 'increment_minutes', p_policy.increment_minutes));
  end if;
  if p_start < p_now + make_interval(mins => p_policy.lead_minutes) then
    return jsonb_build_object('code', 'VALIDATION_FAILED', 'detail', jsonb_build_object(
      'field', 'start_at', 'reason', 'lead_time', 'lead_minutes', p_policy.lead_minutes));
  end if;
  if p_start > p_now + make_interval(days => p_policy.max_horizon_days) then
    return jsonb_build_object('code', 'VALIDATION_FAILED', 'detail', jsonb_build_object(
      'field', 'start_at', 'reason', 'horizon', 'max_horizon_days', p_policy.max_horizon_days));
  end if;
  -- The cleaning buffer must also fit inside opening hours (docs/02 s.4).
  if not app.within_opening_hours(p_venue.id, p_venue.active_schedule_version, p_venue.timezone,
                                  p_start, p_end + make_interval(mins => p_policy.buffer_minutes)) then
    return jsonb_build_object('code', 'OUTSIDE_HOURS', 'detail', '{}'::jsonb);
  end if;
  return null;
end;
$$;

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
  v_problem jsonb := app.slot_problem(p_venue, p_resource, p_policy, p_start, p_end, p_party_size, p_now);
begin
  if v_problem is not null then
    perform app.fail(v_problem ->> 'code', v_problem -> 'detail');
  end if;
end;
$$;

-- True when an active claim (closure, confirmed, or a hold not yet due) blocks [p_start, p_end) on the table.
create or replace function app.is_blocked(p_resource_id uuid, p_start timestamptz, p_end timestamptz, p_now timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.inventory_claims c
    where c.resource_id = p_resource_id
      and c.active
      and (c.expires_at is null or c.expires_at > p_now)
      and c.blocked_range && tstzrange(p_start, p_end, '[)')
  );
$$;

-- Server price for one table and duration at the rate effective at service start. Returns {error: field} instead of
-- raising so search can show an indicative price; create_quote fails closed on error.
create or replace function app.price_for(p_resource_id uuid, p_start timestamptz, p_duration_minutes integer)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_rate public.resource_rates;
  v_fee public.fee_configurations;
  v_base bigint;
begin
  select r.* into v_rate
  from public.resource_rates r
  where r.resource_id = p_resource_id
    and r.effective_from <= p_start
    and (r.effective_to is null or p_start < r.effective_to);
  if not found then
    return jsonb_build_object('error', 'rate');
  end if;
  select f.* into v_fee
  from public.fee_configurations f
  where f.config_version = v_rate.fee_config_version and f.status = 'APPROVED' and f.effective_from <= p_start;
  if not found then
    return jsonb_build_object('error', 'fee_configuration');
  end if;
  -- No tax rate is approved (decision register D04). Fail closed rather than invent one.
  if jsonb_array_length(v_fee.tax_rules) > 0 then
    return jsonb_build_object('error', 'tax_rules');
  end if;
  v_base := app.div_half_up(v_rate.hourly_paise * p_duration_minutes, 60);
  return jsonb_build_object(
    'schema', 'price.v1',
    'currency', 'INR',
    'base_paise', v_base,
    'service_fee_paise', v_fee.customer_fee_paise,
    'tax_lines', '[]'::jsonb,
    'discount_paise', 0,
    'total_paise', v_base + v_fee.customer_fee_paise,
    'hourly_paise', v_rate.hourly_paise,
    'duration_minutes', p_duration_minutes,
    'rate_version', v_rate.rate_version,
    'fee_config_version', v_fee.config_version,
    'commission_bps', v_fee.commission_bps,
    'platform_fixed_paise', v_fee.platform_fixed_paise,
    'rounding_rule', v_fee.rounding_rule,
    'synthetic', v_fee.is_synthetic);
end;
$$;

-- POST /quotes, now through the shared price function (same arithmetic as M2; consistency.test.ts re-checks it).
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
  v_end timestamptz;
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
  if app.is_blocked(v_resource.id, p_start_at, v_end + make_interval(mins => v_policy.buffer_minutes), v_now) then
    perform app.fail('SLOT_UNAVAILABLE');
  end if;

  v_price := app.price_for(v_resource.id, p_start_at, p_duration_minutes);
  if v_price ? 'error' then
    perform app.fail('POLICY_NOT_CONFIGURED', jsonb_build_object('field', v_price ->> 'error'));
  end if;

  insert into public.quotes (
    customer_id, venue_id, resource_id, start_at, end_at, party_size, price_snapshot, policy_snapshot,
    policy_id, policy_hash, rate_version, total_paise, expires_at
  ) values (
    v_actor, v_venue.id, v_resource.id, p_start_at, v_end, p_party_size, v_price, app.policy_snapshot(v_policy),
    v_policy.id, v_policy.content_hash, (v_price ->> 'rate_version')::integer, (v_price ->> 'total_paise')::bigint,
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

-- GET /venues. Published venues only. Coordinates are rounded (about 1 km) before use and never stored or logged.
-- With a slot (start + duration) each venue reports how many compatible tables are free and why the others are not.
create or replace function app.search_venues(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer,
  p_start timestamptz,
  p_duration_minutes integer,
  p_party_size integer,
  p_categories text[],
  p_requirements text[],
  p_environment text[],
  p_amenities text[],
  p_available_only boolean,
  p_offset integer,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_origin extensions.geography;
  v_radius integer := greatest(500, least(coalesce(p_radius_m, 5000), 25000));
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_party integer := greatest(1, coalesce(p_party_size, 1));
  v_slot boolean := p_start is not null and p_duration_minutes is not null;
  v_items jsonb;
  v_total integer;
begin
  if (p_lat is null) <> (p_lng is null) then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'lat'));
  end if;
  if p_lat is not null then
    v_origin := extensions.st_setsrid(
      extensions.st_makepoint(round(p_lng::numeric, 2)::double precision, round(p_lat::numeric, 2)::double precision),
      4326)::extensions.geography;
  end if;

  with candidates as (
    select v.id, v.slug, v.name, v.category_code, v.locality, v.is_synthetic, v.location,
           p.id as policy_id, p.byo_food, p.byo_details, p.outside_delivery, p.buffer_minutes,
           case when v_origin is null then null else extensions.st_distance(v.location, v_origin) end as distance_m
    from public.venues v
    join public.venue_policies p on p.id = v.active_policy_id and p.status = 'PUBLISHED'
    where v.status = 'PUBLISHED'
      and (p_categories is null or v.category_code = any (p_categories))
      and (v_origin is null or extensions.st_dwithin(v.location, v_origin, v_radius))
      and (p_requirements is null or exists (
            select 1 from public.venue_tags t
            where t.venue_id = v.id and t.tag_group = 'REQUIREMENT' and t.tag_code = any (p_requirements)))
      and (p_environment is null or not exists (
            select 1 from unnest(p_environment) e (code)
            where not exists (select 1 from public.venue_tags t
                              where t.venue_id = v.id and t.tag_group = 'ENVIRONMENT' and t.tag_code = e.code)))
      and (p_amenities is null or not exists (
            select 1 from unnest(p_amenities) a (code)
            where not exists (select 1 from public.venue_amenities va
                              where va.venue_id = v.id and va.code = a.code and va.value)))
      and exists (select 1 from public.resources r
                  where r.venue_id = v.id and r.status = 'ACTIVE' and r.capacity >= v_party)
  ),
  scored as (
    select c.*,
      (select min(rr.hourly_paise)
         from public.resources r
         join public.resource_rates rr on rr.resource_id = r.id
        where r.venue_id = c.id and r.status = 'ACTIVE' and r.capacity >= v_party
          and rr.effective_from <= coalesce(p_start, v_now)
          and (rr.effective_to is null or coalesce(p_start, v_now) < rr.effective_to)) as from_hourly_paise,
      case when not v_slot then null else (
        select jsonb_build_object(
          'available_tables', count(*) filter (where pr.problem is null and not pr.blocked),
          'checked_tables', count(*),
          'problems', coalesce(
            jsonb_agg(distinct case when pr.problem is not null then pr.problem ->> 'code' else 'BOOKED' end)
              filter (where pr.problem is not null or pr.blocked),
            '[]'::jsonb))
        from public.resources r
        cross join lateral (
          select app.slot_problem(vv, r, pp, p_start, p_start + make_interval(mins => p_duration_minutes), v_party, v_now) as problem,
                 app.is_blocked(r.id, p_start, p_start + make_interval(mins => p_duration_minutes + c.buffer_minutes), v_now) as blocked
          from public.venues vv, public.venue_policies pp
          where vv.id = c.id and pp.id = c.policy_id
        ) pr
        where r.venue_id = c.id and r.status = 'ACTIVE' and r.capacity >= v_party
      ) end as availability
    from candidates c
  ),
  filtered as (
    select s.*,
           case when s.availability is null then 0
                when (s.availability ->> 'available_tables')::integer > 0 then 1 else 0 end as available_rank,
           count(*) over () as total
    from scored s
    where not coalesce(p_available_only, false) or s.availability is null
       or (s.availability ->> 'available_tables')::integer > 0
  ),
  page as (
    select * from filtered
    order by available_rank desc, distance_m nulls last, name, id
    offset v_offset limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pg.id,
           'slug', pg.slug,
           'name', pg.name,
           'category_code', pg.category_code,
           'locality', pg.locality,
           'is_synthetic', pg.is_synthetic,
           'lat', round(extensions.st_y(pg.location::extensions.geometry)::numeric, 4),
           'lng', round(extensions.st_x(pg.location::extensions.geometry)::numeric, 4),
           'distance_m', case when pg.distance_m is null then null else round(pg.distance_m)::integer end,
           'from_hourly_paise', pg.from_hourly_paise,
           'byo_food', pg.byo_food,
           'byo_details', left(pg.byo_details, 280),
           'outside_delivery', pg.outside_delivery,
           'max_capacity', (select max(r.capacity) from public.resources r where r.venue_id = pg.id and r.status = 'ACTIVE'),
           'requirements', coalesce((select jsonb_agg(t.tag_code order by t.tag_code) from public.venue_tags t
                                     where t.venue_id = pg.id and t.tag_group = 'REQUIREMENT'), '[]'::jsonb),
           'environment', coalesce((select jsonb_agg(t.tag_code order by t.tag_code) from public.venue_tags t
                                    where t.venue_id = pg.id and t.tag_group = 'ENVIRONMENT'), '[]'::jsonb),
           'amenities', coalesce((select jsonb_agg(a.code order by a.code) from public.venue_amenities a
                                  where a.venue_id = pg.id and a.value), '[]'::jsonb),
           'availability', pg.availability)
         order by pg.available_rank desc, pg.distance_m nulls last, pg.name, pg.id), '[]'::jsonb),
         max(pg.total)
    into v_items, v_total
  from page pg;

  return jsonb_build_object(
    'venues', v_items,
    'total', coalesce(v_total, 0),
    'next_offset', case when v_offset + v_limit < coalesce(v_total, 0) then v_offset + v_limit end,
    'searched_at', v_now);
end;
$$;

-- GET /venues/{id}: sanitized public detail of a published venue (null when not published).
create or replace function app.venue_detail(p_venue_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', v.id, 'slug', v.slug, 'name', v.name, 'category_code', v.category_code, 'description', v.description,
    'address', v.address, 'locality', v.locality, 'timezone', v.timezone, 'is_synthetic', v.is_synthetic,
    'lat', round(extensions.st_y(v.location::extensions.geometry)::numeric, 4),
    'lng', round(extensions.st_x(v.location::extensions.geometry)::numeric, 4),
    'policy', jsonb_build_object(
      'policy_id', p.id, 'policy_version', p.policy_version, 'policy_hash', p.content_hash,
      'byo_food', p.byo_food, 'byo_details', p.byo_details, 'outside_delivery', p.outside_delivery,
      'handover_instructions', p.handover_instructions, 'house_rules', p.house_rules,
      'cancel_cutoff_minutes', p.cancel_cutoff_minutes, 'early_refund_bps', p.early_refund_bps,
      'late_refund_bps', p.late_refund_bps, 'minimum_minutes', p.minimum_minutes,
      'increment_minutes', p.increment_minutes, 'maximum_minutes', p.maximum_minutes,
      'buffer_minutes', p.buffer_minutes, 'grace_minutes', p.grace_minutes, 'lead_minutes', p.lead_minutes,
      'max_horizon_days', p.max_horizon_days, 'hold_minutes', p.hold_minutes),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object('resource_id', r.id, 'label', r.label, 'capacity', r.capacity,
                                          'hourly_paise', rr.hourly_paise) order by r.label)
      from public.resources r
      left join public.resource_rates rr on rr.resource_id = r.id
        and rr.effective_from <= clock_timestamp() and (rr.effective_to is null or clock_timestamp() < rr.effective_to)
      where r.venue_id = v.id and r.status = 'ACTIVE'), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', op.weekday, 'opens', to_char(op.opens_local, 'HH24:MI'),
                                          'closes', to_char(op.closes_local, 'HH24:MI'),
                                          'closes_next_day', op.closes_next_day) order by op.weekday, op.opens_local)
      from public.opening_periods op
      where op.venue_id = v.id and op.schedule_version = v.active_schedule_version), '[]'::jsonb),
    'amenities', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'verified', a.verified_at is not null)
                                            order by a.code)
                           from public.venue_amenities a where a.venue_id = v.id and a.value), '[]'::jsonb),
    'requirements', coalesce((select jsonb_agg(t.tag_code order by t.tag_code) from public.venue_tags t
                              where t.venue_id = v.id and t.tag_group = 'REQUIREMENT'), '[]'::jsonb),
    'environment', coalesce((select jsonb_agg(t.tag_code order by t.tag_code) from public.venue_tags t
                             where t.venue_id = v.id and t.tag_group = 'ENVIRONMENT'), '[]'::jsonb))
  from public.venues v
  join public.venue_policies p on p.id = v.active_policy_id and p.status = 'PUBLISHED'
  where v.id = p_venue_id and v.status = 'PUBLISHED';
$$;

-- GET /venues/{id}/availability: bookable start times per compatible table for one venue-local date. Advisory only.
create or replace function app.venue_day_availability(p_venue_id uuid, p_date date, p_duration_minutes integer, p_party_size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_venue public.venues;
  v_policy public.venue_policies;
  v_tables jsonb;
  v_party integer := greatest(1, coalesce(p_party_size, 1));
begin
  select * into v_venue from public.venues where id = p_venue_id and status = 'PUBLISHED';
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  select * into v_policy from public.venue_policies where id = v_venue.active_policy_id and status = 'PUBLISHED';
  if not found then
    perform app.fail('POLICY_NOT_CONFIGURED', jsonb_build_object('field', 'policy'));
  end if;
  if p_date is null or p_duration_minutes is null then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'date'));
  end if;
  if p_duration_minutes < v_policy.minimum_minutes or p_duration_minutes > v_policy.maximum_minutes
     or p_duration_minutes % v_policy.increment_minutes <> 0 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object(
      'field', 'duration_minutes', 'minimum_minutes', v_policy.minimum_minutes,
      'maximum_minutes', v_policy.maximum_minutes, 'increment_minutes', v_policy.increment_minutes));
  end if;

  select coalesce(jsonb_agg(t.item order by t.label), '[]'::jsonb) into v_tables
  from (
    select r.label, jsonb_build_object(
      'resource_id', r.id,
      'label', r.label,
      'capacity', r.capacity,
      'price', app.price_for(r.id, (p_date + time '12:00') at time zone v_venue.timezone, p_duration_minutes),
      'starts', coalesce((
        select jsonb_agg(s.start_at order by s.start_at)
        from (
          select (p_date + make_interval(mins => g * v_policy.increment_minutes)) at time zone v_venue.timezone as start_at
          from generate_series(0, (1440 / v_policy.increment_minutes) - 1) g
        ) s
        where app.slot_problem(v_venue, r, v_policy, s.start_at, s.start_at + make_interval(mins => p_duration_minutes),
                               v_party, v_now) is null
          and not app.is_blocked(r.id, s.start_at,
                                 s.start_at + make_interval(mins => p_duration_minutes + v_policy.buffer_minutes), v_now)
      ), '[]'::jsonb)) as item
    from public.resources r
    where r.venue_id = v_venue.id and r.status = 'ACTIVE' and r.capacity >= v_party
  ) t;

  return jsonb_build_object(
    'venue_id', v_venue.id,
    'date', p_date,
    'timezone', v_venue.timezone,
    'duration_minutes', p_duration_minutes,
    'party_size', v_party,
    'increment_minutes', v_policy.increment_minutes,
    'tables', v_tables,
    'reason', case when jsonb_array_length(v_tables) = 0 then 'PARTY_TOO_LARGE' end,
    'checked_at', v_now);
end;
$$;

-- Customer projections -------------------------------------------------------------------------------------------
-- Highest observed payment state across attempts; separate from booking, allocation and refund state (docs/07 s.7).
create or replace function app.booking_payment_summary(p_booking_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'payment_order_id', o.id,
    'order_state', o.state,
    'provider', o.provider,
    'environment', o.environment,
    'payment_state', coalesce((
      select a.state from public.payment_attempts a where a.payment_order_id = o.id
      order by case a.state when 'CAPTURED' then 3 when 'FAILED' then 2 when 'AUTHORIZED' then 1 else 0 end desc,
               a.created_at desc
      limit 1), 'NONE'),
    'allocation', (
      select case
        when bool_or(a.allocation_state = 'BOOKING') then 'ALLOCATED'
        when bool_or(a.allocation_state = 'QUARANTINED') then 'UNDER_REVIEW'
        when bool_or(a.allocation_state = 'REFUND_DUE') then 'REFUND_DUE'
        when bool_or(a.allocation_state = 'REFUNDED') then 'REFUNDED'
      end
      from public.payment_attempts a where a.booking_id = p_booking_id),
    'failed_attempts', (select count(*) from public.payment_attempts a where a.payment_order_id = o.id and a.state = 'FAILED'))
  from public.payment_orders o
  where o.booking_id = p_booking_id
  order by o.attempt_no desc
  limit 1;
$$;

create or replace function app.customer_booking_json(p_booking public.bookings)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'booking_id', p_booking.id,
    'public_ref', p_booking.public_ref,
    'status', p_booking.status,
    'hold_active', p_booking.status in ('HOLD', 'PENDING_PAYMENT') and p_booking.hold_expires_at > clock_timestamp(),
    'start_at', p_booking.start_at,
    'end_at', p_booking.end_at,
    'party_size', p_booking.party_size,
    'hold_expires_at', p_booking.hold_expires_at,
    'confirmed_at', p_booking.confirmed_at,
    'checked_in_at', p_booking.checked_in_at,
    'checked_out_at', p_booking.checked_out_at,
    'cancelled_at', p_booking.cancelled_at,
    'expired_at', p_booking.expired_at,
    'total_paise', p_booking.total_paise,
    'currency', p_booking.currency,
    'price_snapshot', p_booking.price_snapshot,
    'policy_snapshot', p_booking.policy_snapshot,
    'version', p_booking.version,
    'venue', (select jsonb_build_object('id', v.id, 'slug', v.slug, 'name', v.name, 'address', v.address,
                                        'locality', v.locality, 'timezone', v.timezone, 'is_synthetic', v.is_synthetic,
                                        'lat', round(extensions.st_y(v.location::extensions.geometry)::numeric, 4),
                                        'lng', round(extensions.st_x(v.location::extensions.geometry)::numeric, 4))
              from public.venues v where v.id = p_booking.venue_id),
    'table', (select jsonb_build_object('label', r.label, 'capacity', r.capacity)
              from public.resources r where r.id = p_booking.resource_id),
    'payment', app.booking_payment_summary(p_booking.id),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('refund_id', f.id, 'status', f.status, 'amount_paise', f.amount_paise,
                                                             'reason_code', f.reason_code, 'created_at', f.created_at)
                                          order by f.created_at)
                         from public.refunds f where f.booking_id = p_booking.id), '[]'::jsonb),
    'server_now', clock_timestamp());
$$;

-- GET /bookings/{id}: the owner's booking or NOT_FOUND (another customer's ID reveals nothing).
create or replace function app.customer_booking(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile uuid := app.my_profile_id();
  v_booking public.bookings;
begin
  if v_profile is null then
    perform app.fail('AUTH_REQUIRED');
  end if;
  select * into v_booking from public.bookings where id = p_booking_id and customer_id = v_profile;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  return app.customer_booking_json(v_booking);
end;
$$;

-- GET /bookings: own bookings for the requested scope (upcoming soonest first; past newest first).
create or replace function app.customer_bookings(p_scope text, p_offset integer, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile uuid := app.my_profile_id();
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_items jsonb;
  v_total integer;
begin
  if v_profile is null then
    perform app.fail('AUTH_REQUIRED');
  end if;
  if p_scope is null or p_scope not in ('upcoming', 'past', 'all') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'scope'));
  end if;
  with mine as (
    select b as booking, b.id, count(*) over () as total,
           case when p_scope = 'upcoming' then extract(epoch from b.start_at) else -extract(epoch from b.start_at) end as sort_key
    from public.bookings b
    where b.customer_id = v_profile
      and (p_scope = 'all'
           or (p_scope = 'upcoming' and b.status in ('HOLD', 'PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN')
               and b.end_at > clock_timestamp())
           or (p_scope = 'past' and not (b.status in ('HOLD', 'PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN')
                                         and b.end_at > clock_timestamp())))
  ),
  page as (
    select * from mine order by sort_key, id offset v_offset limit v_limit
  )
  select coalesce(jsonb_agg(app.customer_booking_json(pg.booking) - 'policy_snapshot' - 'price_snapshot'
                            order by pg.sort_key, pg.id), '[]'::jsonb),
         max(pg.total)
    into v_items, v_total
  from page pg;
  return jsonb_build_object('bookings', v_items, 'total', coalesce(v_total, 0),
                            'next_offset', case when v_offset + v_limit < coalesce(v_total, 0) then v_offset + v_limit end);
end;
$$;

-- GET /payment-orders/{id}: owner-only status for the payment return screen.
create or replace function app.customer_payment_order(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile uuid := app.my_profile_id();
  v_order public.payment_orders;
  v_booking public.bookings;
begin
  if v_profile is null then
    perform app.fail('AUTH_REQUIRED');
  end if;
  select * into v_order from public.payment_orders where id = p_order_id and customer_id = v_profile;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  select * into v_booking from public.bookings where id = v_order.booking_id;
  return app.payment_order_json(v_order) || jsonb_build_object(
    'booking', app.customer_booking_json(v_booking) - 'policy_snapshot' - 'price_snapshot');
end;
$$;

-- Staff arrival (P06) ---------------------------------------------------------------------------------------------
create index bookings_checkin_token_idx on public.bookings (checkin_token_hash) where checkin_token_hash is not null;

create or replace function app.sha256_hex(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_value, 'UTF8'), 'sha256'), 'hex');
$$;

-- Assigned staff, manager or owner with a TOTP-verified session. Unassigned callers get NOT_FOUND.
create or replace function app.require_venue_staff(p_venue_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
begin
  if not app.is_venue_member(p_venue_id) then
    perform app.fail('NOT_FOUND');
  end if;
  perform app.require_aal2();
  return v_actor;
end;
$$;

-- GET /partner/arrivals: minimal operational data for one venue-local date. No customer identity, contact or money.
create or replace function app.staff_arrivals(p_venue_id uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
begin
  perform app.require_venue_staff(p_venue_id);
  select timezone into v_tz from public.venues where id = p_venue_id;
  return jsonb_build_object(
    'venue_id', p_venue_id,
    'date', p_date,
    'timezone', v_tz,
    'server_now', clock_timestamp(),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'booking_id', b.id, 'public_ref', b.public_ref, 'status', b.status, 'start_at', b.start_at,
               'end_at', b.end_at, 'party_size', b.party_size, 'resource_id', b.resource_id, 'table_label', r.label,
               'checked_in_at', b.checked_in_at, 'checked_out_at', b.checked_out_at, 'version', b.version)
             order by b.start_at, r.label)
      from public.bookings b join public.resources r on r.id = b.resource_id
      where b.venue_id = p_venue_id
        and b.status in ('CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW')
        and b.start_at < ((p_date + 1)::timestamp at time zone v_tz)
        and b.end_at > (p_date::timestamp at time zone v_tz)), '[]'::jsonb),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object('resource_id', r.id, 'label', r.label, 'capacity', r.capacity,
                                          'status', r.status, 'operational_state', r.operational_state,
                                          'operational_since', r.operational_since, 'version', r.version)
                       order by r.label)
      from public.resources r where r.venue_id = p_venue_id and r.status <> 'RETIRED'), '[]'::jsonb));
end;
$$;

-- POST /partner/check-in. The scanned QR token, or the booking reference plus PIN, is hashed and compared here.
-- An unknown, wrong-venue or wrong code returns outcome INVALID (no detail) and is logged so it commits; repeated
-- failures by one staff member are rate limited from that log. Valid codes then face window, readiness and overlap.
create or replace function app.staff_check_in(
  p_venue_id uuid, p_token text, p_public_ref text, p_pin text, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_venue_staff(p_venue_id);
  v_method text := case when p_token is not null then 'TOKEN' else 'PIN' end;
  v_booking_id uuid;
  v_booking public.bookings;
  v_resource public.resources;
  v_now timestamptz;
  v_grace integer;
begin
  if (p_token is null) = (p_public_ref is null or p_pin is null) then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'code'));
  end if;
  if (select count(*) from public.arrival_attempts
       where staff_profile_id = v_actor and outcome = 'FAILED' and created_at > clock_timestamp() - interval '15 minutes') >= 10 then
    perform app.fail('RATE_LIMITED');
  end if;

  if p_token is not null then
    select id into v_booking_id from public.bookings
     where venue_id = p_venue_id and checkin_token_hash = app.sha256_hex(p_token);
  else
    select id into v_booking_id from public.bookings
     where venue_id = p_venue_id and public_ref = upper(trim(p_public_ref))
       and checkin_pin_hash = app.sha256_hex(id::text || ':' || p_pin);
  end if;
  if v_booking_id is null then
    insert into public.arrival_attempts (venue_id, staff_profile_id, method, outcome)
    values (p_venue_id, v_actor, v_method, 'FAILED');
    return jsonb_build_object('outcome', 'INVALID');
  end if;

  v_now := app.lock_booking(v_booking_id);
  select * into v_booking from public.bookings where id = v_booking_id;
  select * into v_resource from public.resources where id = v_booking.resource_id;

  if v_booking.status = 'CHECKED_IN' then
    return jsonb_build_object('outcome', 'ALREADY_CHECKED_IN', 'booking_id', v_booking.id, 'public_ref', v_booking.public_ref,
                              'status', v_booking.status, 'checked_in_at', v_booking.checked_in_at,
                              'table_label', v_resource.label, 'party_size', v_booking.party_size, 'version', v_booking.version);
  end if;
  if v_booking.status <> 'CONFIRMED' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_booking.status));
  end if;

  v_grace := coalesce((v_booking.policy_snapshot ->> 'grace_minutes')::integer, 15);
  if v_now < v_booking.start_at - interval '15 minutes' then
    perform app.fail('CHECK_IN_NOT_OPEN', jsonb_build_object('reason', 'too_early',
                                                             'opens_at', v_booking.start_at - interval '15 minutes'));
  end if;
  if v_now > v_booking.start_at + make_interval(mins => v_grace) then
    perform app.fail('CHECK_IN_NOT_OPEN', jsonb_build_object('reason', 'grace_elapsed'));
  end if;
  -- Early arrival cannot occupy time sold to another guest or covered by a closure.
  if v_now < v_booking.start_at and exists (
    select 1 from public.inventory_claims c
    where c.resource_id = v_booking.resource_id and c.active and c.booking_id is distinct from v_booking.id
      and (c.expires_at is null or c.expires_at > v_now)
      and c.blocked_range && tstzrange(v_now, v_booking.start_at, '[)')
  ) then
    perform app.fail('CHECK_IN_NOT_OPEN', jsonb_build_object('reason', 'previous_booking', 'opens_at', v_booking.start_at));
  end if;
  if v_resource.operational_state <> 'READY' then
    perform app.fail('TABLE_NOT_READY', jsonb_build_object('operational_state', v_resource.operational_state));
  end if;

  update public.bookings set status = 'CHECKED_IN', checked_in_at = v_now where id = v_booking.id returning * into v_booking;
  update public.resources set operational_state = 'OCCUPIED', operational_since = v_now where id = v_resource.id;
  insert into public.booking_events (booking_id, actor_id, event_type, from_status, to_status, reason_code, request_id, business_key)
  values (v_booking.id, v_actor, 'CHECKED_IN', 'CONFIRMED', 'CHECKED_IN', v_method, p_request_id,
          'booking:' || v_booking.id || ':checked_in');
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, venue_id, request_id, safe_diff)
  values (v_actor, 'VENUE_STAFF', 'booking.check_in', 'booking', v_booking.id, p_venue_id, p_request_id,
          jsonb_build_object('method', v_method, 'resource_id', v_resource.id));
  insert into public.arrival_attempts (venue_id, staff_profile_id, method, outcome, booking_id)
  values (p_venue_id, v_actor, v_method, 'SUCCESS', v_booking.id);

  return jsonb_build_object('outcome', 'CHECKED_IN', 'booking_id', v_booking.id, 'public_ref', v_booking.public_ref,
                            'status', v_booking.status, 'checked_in_at', v_booking.checked_in_at,
                            'table_label', v_resource.label, 'party_size', v_booking.party_size, 'version', v_booking.version);
end;
$$;

-- POST /partner/bookings/{id}/check-out: COMPLETED, arrival codes revoked, table CLEANING. The sold interval and
-- buffer stay claimed (early departure never resells time automatically).
create or replace function app.staff_check_out(p_booking_id uuid, p_expected_version integer, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue uuid;
  v_actor uuid;
  v_booking public.bookings;
  v_now timestamptz;
begin
  select venue_id into v_venue from public.bookings where id = p_booking_id;
  if v_venue is null then
    perform app.fail('NOT_FOUND');
  end if;
  v_actor := app.require_venue_staff(v_venue);
  v_now := app.lock_booking(p_booking_id);
  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking.status = 'COMPLETED' then
    return jsonb_build_object('booking_id', v_booking.id, 'status', v_booking.status, 'checked_out_at', v_booking.checked_out_at,
                              'version', v_booking.version, 'already', true);
  end if;
  if v_booking.status <> 'CHECKED_IN' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_booking.status));
  end if;
  if v_booking.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_booking.version, 'status', v_booking.status));
  end if;
  update public.bookings
     set status = 'COMPLETED', checked_out_at = v_now, checkin_token_hash = null, checkin_pin_hash = null
   where id = v_booking.id returning * into v_booking;
  update public.resources set operational_state = 'CLEANING', operational_since = v_now where id = v_booking.resource_id;
  insert into public.booking_events (booking_id, actor_id, event_type, from_status, to_status, request_id, business_key)
  values (v_booking.id, v_actor, 'CHECKED_OUT', 'CHECKED_IN', 'COMPLETED', p_request_id, 'booking:' || v_booking.id || ':completed');
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, venue_id, request_id, safe_diff)
  values (v_actor, 'VENUE_STAFF', 'booking.check_out', 'booking', v_booking.id, v_venue, p_request_id,
          jsonb_build_object('resource_id', v_booking.resource_id));
  return jsonb_build_object('booking_id', v_booking.id, 'status', v_booking.status, 'checked_out_at', v_booking.checked_out_at,
                            'version', v_booking.version, 'already', false);
end;
$$;

-- POST /partner/resources/{id}/ready: staff confirm turnover. Never while a guest is checked in at the table.
create or replace function app.staff_mark_ready(p_resource_id uuid, p_expected_version integer, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resource public.resources;
  v_actor uuid;
begin
  select * into v_resource from public.resources where id = p_resource_id;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  v_actor := app.require_venue_staff(v_resource.venue_id);
  perform 1 from public.venues where id = v_resource.venue_id for update;
  select * into v_resource from public.resources where id = p_resource_id for update;
  if v_resource.operational_state = 'READY' then
    return jsonb_build_object('resource_id', v_resource.id, 'operational_state', v_resource.operational_state,
                              'version', v_resource.version, 'already', true);
  end if;
  if v_resource.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_resource.version,
                                                         'operational_state', v_resource.operational_state));
  end if;
  if v_resource.operational_state <> 'CLEANING' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('operational_state', v_resource.operational_state));
  end if;
  if exists (select 1 from public.bookings where resource_id = p_resource_id and status = 'CHECKED_IN') then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'guest_checked_in'));
  end if;
  update public.resources set operational_state = 'READY', operational_since = clock_timestamp()
   where id = p_resource_id returning * into v_resource;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, venue_id, request_id, safe_diff)
  values (v_actor, 'VENUE_STAFF', 'resource.ready', 'resource', v_resource.id, v_resource.venue_id, p_request_id, '{}'::jsonb);
  return jsonb_build_object('resource_id', v_resource.id, 'operational_state', v_resource.operational_state,
                            'version', v_resource.version, 'already', false);
end;
$$;


-- GET /partner/bookings calendar for assigned staff/managers (aal2). Same minimal columns as M2 exposed to staff,
-- now through a function because staff no longer read booking rows directly (review fix R1).
create or replace function app.venue_bookings_calendar(p_venue_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_venue_staff(p_venue_id);
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '62 days' then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'range'));
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'public_ref', b.public_ref, 'status', b.status, 'start_at', b.start_at, 'end_at', b.end_at,
             'party_size', b.party_size, 'resource_label', r.label, 'version', b.version) order by b.start_at)
    from public.bookings b join public.resources r on r.id = b.resource_id
    where b.venue_id = p_venue_id and b.start_at < p_to and b.end_at > p_from
      and b.status in ('HOLD', 'PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW')), '[]'::jsonb);
end;
$$;
