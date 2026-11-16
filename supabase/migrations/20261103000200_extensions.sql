-- M4.2 extensions (docs/03 C11 + extension deadlines; docs/05 extension_requests; docs/07 s.4, s.6, s.8; docs/08 T11).
-- Three phase deadlines: staff decide within request + 5 min; approval gives decision + 5 min to start a hold; a hold
-- lasts until min(hold + 5 min, original end). The hold widens the booking's own claim under the same locks as holds;
-- only a verified, exact capture before the hold deadline moves the booking end. Anything else is refund liability and
-- the original booking is never touched. Expiry, cancellation and check-out shrink the claim back.

create table public.extension_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  venue_id uuid not null,
  customer_id uuid not null references public.profiles (id),
  additional_minutes integer not null check (additional_minutes > 0),
  original_end_at timestamptz not null,
  requested_end_at timestamptz not null,
  incremental_price_snapshot jsonb not null check (jsonb_typeof(incremental_price_snapshot) = 'object'),
  amount_paise bigint not null check (amount_paise > 0),
  status text not null default 'REQUESTED' check (status in (
    'REQUESTED', 'APPROVED', 'DECLINED', 'HELD', 'PENDING_PAYMENT', 'APPLIED', 'EXPIRED', 'CANCELLED'
  )),
  request_expires_at timestamptz not null,
  decided_at timestamptz,
  decided_by uuid references public.profiles (id),
  decline_reason text check (decline_reason is null or char_length(decline_reason) between 3 and 300),
  approval_expires_at timestamptz,
  hold_created_at timestamptz,
  hold_expires_at timestamptz,
  applied_at timestamptz,
  ended_at timestamptz,
  end_reason text check (end_reason is null or char_length(end_reason) <= 60),
  base_booking_version integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint extension_requests_booking_fk foreign key (booking_id, venue_id) references public.bookings (id, venue_id),
  constraint extension_requests_range check (requested_end_at > original_end_at),
  constraint extension_requests_approval check (status not in ('APPROVED', 'HELD', 'PENDING_PAYMENT', 'APPLIED') or approval_expires_at is not null),
  constraint extension_requests_hold check (status not in ('HELD', 'PENDING_PAYMENT', 'APPLIED') or hold_expires_at is not null)
);
comment on table public.extension_requests is 'Extension of a checked-in booking. The booking end moves only when a timely capture applies it.';
create unique index extension_requests_one_open on public.extension_requests (booking_id)
  where status in ('REQUESTED', 'APPROVED', 'HELD', 'PENDING_PAYMENT');
create index extension_requests_due_idx on public.extension_requests (status, request_expires_at, approval_expires_at, hold_expires_at);
create index extension_requests_venue_idx on public.extension_requests (venue_id, status);
create trigger extension_requests_touch before update on public.extension_requests for each row execute function app.touch_row();
alter table public.extension_requests enable row level security;
alter table public.extension_requests force row level security;

-- One active payment order per booking (its own) and one per extension.
alter table public.payment_orders add column extension_id uuid references public.extension_requests (id);
drop index public.payment_orders_one_active;
create unique index payment_orders_one_active on public.payment_orders (booking_id)
  where extension_id is null and state in ('CREATED', 'ORDER_PENDING', 'READY', 'UNKNOWN');
create unique index payment_orders_one_active_extension on public.payment_orders (extension_id)
  where extension_id is not null and state in ('CREATED', 'ORDER_PENDING', 'READY', 'UNKNOWN');

alter table public.ledger_journals drop constraint ledger_journals_kind_check;
alter table public.ledger_journals add constraint ledger_journals_kind_check check (kind in (
  'CAPTURE_ALLOCATED_BOOKING', 'CAPTURE_ALLOCATED_EXTENSION', 'CAPTURE_REFUND_DUE', 'CAPTURE_QUARANTINED', 'REFUND_PROCESSED',
  'CANCELLATION_REFUND_DUE', 'NO_SHOW_REFUND_DUE'
));
alter table public.outbox_jobs drop constraint outbox_jobs_kind_check;
alter table public.outbox_jobs add constraint outbox_jobs_kind_check check (kind in (
  'booking.hold_expired', 'booking.confirmed', 'booking.cancelled', 'booking.no_show', 'notification.email',
  'privacy.delete_requested', 'diagnostic.sleep', 'payment.provider_event', 'refund.submit', 'refund.requested',
  'invitation.created', 'extension.notify'
));

-- The booking end may move only to the requested end of its own HELD/PENDING_PAYMENT extension (applied in the same
-- transaction as the verified capture). Every other snapshot/identity field stays immutable.
create or replace function app.guard_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  if tg_op = 'DELETE' then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'bookings'));
  end if;
  if (new.public_ref, new.customer_id, new.venue_id, new.resource_id, new.quote_id, new.start_at,
      new.party_size, new.price_snapshot, new.policy_snapshot, new.accepted_policy_hash, new.accepted_at,
      new.total_paise, new.currency)
     is distinct from
     (old.public_ref, old.customer_id, old.venue_id, old.resource_id, old.quote_id, old.start_at,
      old.party_size, old.price_snapshot, old.policy_snapshot, old.accepted_policy_hash, old.accepted_at,
      old.total_paise, old.currency) then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'bookings', 'reason', 'snapshot_or_identity'));
  end if;
  if new.end_at is distinct from old.end_at and not exists (
    select 1 from public.extension_requests e
    where e.booking_id = new.id and e.status in ('HELD', 'PENDING_PAYMENT')
      and e.original_end_at = old.end_at and e.requested_end_at = new.end_at
  ) then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'bookings', 'reason', 'end_at'));
  end if;
  if new.status is distinct from old.status then
    v_allowed := (old.status, new.status) in (
      ('HOLD', 'PENDING_PAYMENT'), ('HOLD', 'CONFIRMED'), ('HOLD', 'EXPIRED'), ('HOLD', 'CANCELLED'),
      ('PENDING_PAYMENT', 'CONFIRMED'), ('PENDING_PAYMENT', 'EXPIRED'), ('PENDING_PAYMENT', 'CANCELLED'),
      ('CONFIRMED', 'CHECKED_IN'), ('CONFIRMED', 'NO_SHOW'), ('CONFIRMED', 'CANCELLED'),
      ('CHECKED_IN', 'COMPLETED')
    );
    if not v_allowed then
      perform app.fail('INVALID_TRANSITION', jsonb_build_object('from', old.status, 'to', new.status));
    end if;
  end if;
  return new;
end;
$$;

-- Incremental price for the added minutes at the rate in force at the original end. No second service fee.
create or replace function app.extension_price(p_resource_id uuid, p_from timestamptz, p_minutes integer)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_price jsonb := app.price_for(p_resource_id, p_from, p_minutes);
begin
  if v_price ? 'error' then
    perform app.fail('POLICY_NOT_CONFIGURED', jsonb_build_object('field', v_price ->> 'error'));
  end if;
  return v_price || jsonb_build_object('kind', 'extension', 'service_fee_paise', 0, 'total_paise', (v_price ->> 'base_paise')::bigint);
end;
$$;

create or replace function app.extension_json(p_ext public.extension_requests)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'extension_id', p_ext.id,
    'booking_id', p_ext.booking_id,
    'status', p_ext.status,
    'additional_minutes', p_ext.additional_minutes,
    'original_end_at', p_ext.original_end_at,
    'requested_end_at', p_ext.requested_end_at,
    'amount_paise', p_ext.amount_paise,
    'currency', 'INR',
    'request_expires_at', p_ext.request_expires_at,
    'approval_expires_at', p_ext.approval_expires_at,
    'hold_expires_at', p_ext.hold_expires_at,
    'decline_reason', p_ext.decline_reason,
    'applied_at', p_ext.applied_at,
    'end_reason', p_ext.end_reason,
    'version', p_ext.version,
    'payment_order_id', (select o.id from public.payment_orders o where o.extension_id = p_ext.id order by o.attempt_no desc limit 1),
    'server_now', clock_timestamp());
$$;

-- Ends an extension (EXPIRED / CANCELLED). A widened claim shrinks back to the committed end plus buffer and any open
-- extension payment order is closed; captures that still arrive become refund liabilities. Caller holds the locks.
create or replace function app.end_extension(p_extension_id uuid, p_status text, p_now timestamptz, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_ext public.extension_requests;
  v_booking public.bookings;
  v_prev text;
begin
  select * into v_ext from public.extension_requests where id = p_extension_id for update;
  v_prev := v_ext.status;
  if v_prev not in ('REQUESTED', 'APPROVED', 'HELD', 'PENDING_PAYMENT') then
    return;
  end if;
  select * into v_booking from public.bookings where id = v_ext.booking_id;
  update public.extension_requests set status = p_status, ended_at = p_now, end_reason = left(p_reason, 60) where id = p_extension_id;
  if v_prev in ('HELD', 'PENDING_PAYMENT') then
    update public.inventory_claims
       set blocked_range = tstzrange(lower(blocked_range),
                                     v_booking.end_at + make_interval(mins => (v_booking.policy_snapshot ->> 'buffer_minutes')::integer), '[)')
     where booking_id = v_booking.id and kind = 'BOOKING' and active
       and upper(blocked_range) > v_booking.end_at + make_interval(mins => (v_booking.policy_snapshot ->> 'buffer_minutes')::integer);
    update public.payment_orders set state = 'EXPIRED', last_error_code = coalesce(last_error_code, 'EXTENSION_' || p_status)
     where extension_id = p_extension_id and state in ('CREATED', 'ORDER_PENDING', 'READY', 'UNKNOWN');
  end if;
  insert into public.booking_events (booking_id, event_type, from_status, to_status, reason_code, business_key, safe_metadata)
  values (v_booking.id, 'EXTENSION_' || p_status, v_booking.status, v_booking.status, left(p_reason, 60),
          'extension:' || p_extension_id || ':' || lower(p_status),
          jsonb_build_object('extension_id', p_extension_id, 'previous_status', v_prev));
  if p_status = 'EXPIRED' then
    perform app.enqueue_job('extension:' || p_extension_id || ':expired', 'extension.notify',
                            jsonb_build_object('booking_id', v_booking.id, 'extension_id', p_extension_id, 'event', 'EXPIRED'));
  end if;
end;
$$;

-- Due holds and due extension phases on one table. Caller holds the venue and resource locks.
create or replace function app.expire_resource_holds(p_resource_id uuid, p_now timestamptz)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer := 0;
  b record;
  e record;
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
    update public.payment_orders set state = 'EXPIRED', last_error_code = coalesce(last_error_code, 'HOLD_EXPIRED')
      where booking_id = b.id and extension_id is null and state in ('CREATED', 'ORDER_PENDING', 'READY', 'UNKNOWN');
    insert into public.booking_events (booking_id, event_type, from_status, to_status, reason_code, business_key)
      values (b.id, 'HOLD_EXPIRED', b.status, 'EXPIRED', 'HOLD_DEADLINE', 'booking:' || b.id || ':expired');
    perform app.enqueue_job('booking:' || b.id || ':hold_expired', 'booking.hold_expired',
                            jsonb_build_object('booking_id', b.id));
    v_count := v_count + 1;
  end loop;
  for e in
    select x.id from public.extension_requests x join public.bookings bk on bk.id = x.booking_id
    where bk.resource_id = p_resource_id
      and ((x.status = 'REQUESTED' and x.request_expires_at <= p_now)
        or (x.status = 'APPROVED' and x.approval_expires_at <= p_now)
        or (x.status in ('HELD', 'PENDING_PAYMENT') and x.hold_expires_at <= p_now))
    order by x.id
  loop
    perform app.end_extension(e.id, 'EXPIRED', p_now, 'DEADLINE');
  end loop;
  return v_count;
end;
$$;

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
    select distinct d.venue_id, d.resource_id from (
      select b.venue_id, b.resource_id from public.bookings b
      where b.status in ('HOLD', 'PENDING_PAYMENT') and b.hold_expires_at <= clock_timestamp()
      union
      select b.venue_id, b.resource_id from public.extension_requests x join public.bookings b on b.id = x.booking_id
      where (x.status = 'REQUESTED' and x.request_expires_at <= clock_timestamp())
         or (x.status = 'APPROVED' and x.approval_expires_at <= clock_timestamp())
         or (x.status in ('HELD', 'PENDING_PAYMENT') and x.hold_expires_at <= clock_timestamp())
    ) d
    order by d.venue_id, d.resource_id
    limit greatest(1, least(p_limit, 500))
  loop
    perform 1 from public.venues where id = r.venue_id for update;
    perform 1 from public.resources where id = r.resource_id for update;
    v_count := v_count + app.expire_resource_holds(r.resource_id, clock_timestamp());
  end loop;
  return v_count;
end;
$$;

-- Widened claim range for an extension and whether another active claim (next booking, blackout) overlaps it.
create or replace function app.extension_conflict(p_booking public.bookings, p_requested_end timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.inventory_claims c
    where c.resource_id = p_booking.resource_id and c.active
      and (c.booking_id is distinct from p_booking.id)
      and c.blocked_range && tstzrange(p_booking.start_at,
                                       p_requested_end + make_interval(mins => (p_booking.policy_snapshot ->> 'buffer_minutes')::integer), '[)'));
$$;

create or replace function app.extension_fits_hours(p_booking public.bookings, p_requested_end timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.within_opening_hours(v.id, v.active_schedule_version, v.timezone, p_booking.start_at,
                                  p_requested_end + make_interval(mins => (p_booking.policy_snapshot ->> 'buffer_minutes')::integer))
  from public.venues v where v.id = p_booking.venue_id;
$$;

-- POST /bookings/{id}/extension-requests (customer, own CHECKED_IN booking before its end).
create or replace function app.request_extension(
  p_booking_id uuid, p_additional_minutes integer, p_expected_version integer, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_booking public.bookings;
  v_now timestamptz;
  v_increment integer;
  v_new_end timestamptz;
  v_price jsonb;
  v_ext public.extension_requests;
begin
  if not exists (select 1 from public.bookings where id = p_booking_id and customer_id = v_actor) then
    perform app.fail('NOT_FOUND');
  end if;
  v_now := app.lock_booking(p_booking_id);
  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking.status <> 'CHECKED_IN' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_booking.status, 'reason', 'not_checked_in'));
  end if;
  if v_now >= v_booking.end_at then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'ended'));
  end if;
  if v_booking.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_booking.version, 'status', v_booking.status));
  end if;
  v_increment := (v_booking.policy_snapshot ->> 'increment_minutes')::integer;
  if p_additional_minutes is null or p_additional_minutes < v_increment or p_additional_minutes % v_increment <> 0 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'additional_minutes', 'increment_minutes', v_increment));
  end if;
  v_new_end := v_booking.end_at + make_interval(mins => p_additional_minutes);
  if extract(epoch from (v_new_end - v_booking.start_at)) / 60 > (v_booking.policy_snapshot ->> 'maximum_minutes')::integer then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'additional_minutes', 'reason', 'max_duration',
                                                             'maximum_minutes', (v_booking.policy_snapshot ->> 'maximum_minutes')::integer));
  end if;
  if exists (select 1 from public.extension_requests where booking_id = p_booking_id
             and status in ('REQUESTED', 'APPROVED', 'HELD', 'PENDING_PAYMENT')) then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'extension_open'));
  end if;
  if not app.extension_fits_hours(v_booking, v_new_end) then
    perform app.fail('OUTSIDE_HOURS');
  end if;
  v_price := app.extension_price(v_booking.resource_id, v_booking.end_at, p_additional_minutes);
  insert into public.extension_requests (
    booking_id, venue_id, customer_id, additional_minutes, original_end_at, requested_end_at, incremental_price_snapshot,
    amount_paise, request_expires_at, base_booking_version)
  values (p_booking_id, v_booking.venue_id, v_actor, p_additional_minutes, v_booking.end_at, v_new_end, v_price,
          (v_price ->> 'total_paise')::bigint, v_now + interval '5 minutes', v_booking.version)
  returning * into v_ext;
  insert into public.booking_events (booking_id, actor_id, event_type, from_status, to_status, request_id, business_key, safe_metadata)
  values (p_booking_id, v_actor, 'EXTENSION_REQUESTED', v_booking.status, v_booking.status, p_request_id,
          'extension:' || v_ext.id || ':requested',
          jsonb_build_object('extension_id', v_ext.id, 'additional_minutes', p_additional_minutes));
  return app.extension_json(v_ext);
end;
$$;

-- POST /partner/extension-requests/{id}/decision (assigned staff/manager with TOTP, before request + 5 min).
create or replace function app.decide_extension(
  p_extension_id uuid, p_decision text, p_reason text, p_expected_version integer, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ext public.extension_requests;
  v_booking public.bookings;
  v_actor uuid;
  v_now timestamptz;
begin
  select * into v_ext from public.extension_requests where id = p_extension_id;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  v_actor := app.require_venue_staff(v_ext.venue_id);
  v_now := app.lock_booking(v_ext.booking_id);
  select * into v_ext from public.extension_requests where id = p_extension_id for update;
  select * into v_booking from public.bookings where id = v_ext.booking_id;
  if v_ext.status = 'EXPIRED' then
    perform app.fail('EXTENSION_EXPIRED');
  end if;
  if v_ext.status <> 'REQUESTED' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_ext.status));
  end if;
  if v_ext.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_ext.version));
  end if;
  if v_booking.status <> 'CHECKED_IN' or v_now >= v_booking.end_at then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'booking_not_active'));
  end if;
  if p_decision = 'APPROVE' then
    -- Approve only while it still looks possible; nothing is reserved until the customer's hold.
    if app.extension_conflict(v_booking, v_ext.requested_end_at) then
      perform app.fail('SLOT_UNAVAILABLE', jsonb_build_object('reason', 'next_booking'));
    end if;
    if not app.extension_fits_hours(v_booking, v_ext.requested_end_at) then
      perform app.fail('OUTSIDE_HOURS');
    end if;
    update public.extension_requests
       set status = 'APPROVED', decided_at = v_now, decided_by = v_actor, approval_expires_at = v_now + interval '5 minutes'
     where id = p_extension_id returning * into v_ext;
  elsif p_decision = 'DECLINE' then
    if p_reason is not null and char_length(trim(p_reason)) not between 3 and 300 then
      perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason'));
    end if;
    update public.extension_requests
       set status = 'DECLINED', decided_at = v_now, decided_by = v_actor, decline_reason = nullif(trim(p_reason), '')
     where id = p_extension_id returning * into v_ext;
  else
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'decision'));
  end if;
  insert into public.booking_events (booking_id, actor_id, event_type, from_status, to_status, request_id, business_key, safe_metadata)
  values (v_booking.id, v_actor, 'EXTENSION_' || v_ext.status, v_booking.status, v_booking.status, p_request_id,
          'extension:' || v_ext.id || ':decided', jsonb_build_object('extension_id', v_ext.id));
  perform app.enqueue_job('extension:' || v_ext.id || ':decided', 'extension.notify',
                          jsonb_build_object('booking_id', v_booking.id, 'extension_id', v_ext.id, 'event', v_ext.status));
  perform app.audit(v_actor, case when app.is_venue_member(v_ext.venue_id, array['MANAGER', 'OWNER']) then 'VENUE_MANAGER' else 'VENUE_STAFF' end,
                    'extension.decide', 'extension_request', v_ext.id, v_ext.venue_id, p_request_id, nullif(trim(p_reason), ''),
                    jsonb_build_object('decision', p_decision));
  return app.extension_json(v_ext);
end;
$$;

-- POST /extension-requests/{id}/hold (customer, before approval + 5 min and before the original end).
create or replace function app.hold_extension(
  p_extension_id uuid, p_accepted_price_paise bigint, p_expected_version integer, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_ext public.extension_requests;
  v_booking public.bookings;
  v_now timestamptz;
  v_price jsonb;
begin
  select * into v_ext from public.extension_requests where id = p_extension_id and customer_id = v_actor;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  v_now := app.lock_booking(v_ext.booking_id);
  select * into v_ext from public.extension_requests where id = p_extension_id for update;
  select * into v_booking from public.bookings where id = v_ext.booking_id;
  if v_ext.status = 'EXPIRED' then
    perform app.fail('EXTENSION_EXPIRED');
  end if;
  if v_ext.status <> 'APPROVED' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_ext.status));
  end if;
  if v_ext.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_ext.version));
  end if;
  if v_booking.status <> 'CHECKED_IN' or v_now >= v_booking.end_at then
    -- No paid extension starts after the original end (the sweep records the expiry).
    perform app.fail('EXTENSION_EXPIRED', jsonb_build_object('reason', 'booking_ended'));
  end if;
  v_price := app.extension_price(v_booking.resource_id, v_booking.end_at, v_ext.additional_minutes);
  if (v_price ->> 'total_paise')::bigint is distinct from p_accepted_price_paise then
    perform app.fail('QUOTE_CHANGED', jsonb_build_object('amount_paise', (v_price ->> 'total_paise')::bigint));
  end if;
  if not app.extension_fits_hours(v_booking, v_ext.requested_end_at) then
    perform app.fail('OUTSIDE_HOURS');
  end if;
  begin
    update public.inventory_claims
       set blocked_range = tstzrange(lower(blocked_range),
                                     v_ext.requested_end_at + make_interval(mins => (v_booking.policy_snapshot ->> 'buffer_minutes')::integer), '[)')
     where booking_id = v_booking.id and kind = 'BOOKING' and active;
  exception when exclusion_violation then
    perform app.fail('SLOT_UNAVAILABLE', jsonb_build_object('reason', 'next_booking'));
  end;
  update public.extension_requests
     set status = 'HELD', hold_created_at = v_now, hold_expires_at = least(v_now + interval '5 minutes', v_booking.end_at),
         incremental_price_snapshot = v_price, amount_paise = (v_price ->> 'total_paise')::bigint
   where id = p_extension_id returning * into v_ext;
  insert into public.booking_events (booking_id, actor_id, event_type, from_status, to_status, request_id, business_key, safe_metadata)
  values (v_booking.id, v_actor, 'EXTENSION_HELD', v_booking.status, v_booking.status, p_request_id,
          'extension:' || v_ext.id || ':held', jsonb_build_object('extension_id', v_ext.id, 'hold_expires_at', v_ext.hold_expires_at));
  return app.extension_json(v_ext);
end;
$$;

-- POST /extension-requests/{id}/checkout: the same durable payment-order protocol, incremental amount only.
create or replace function app.begin_extension_checkout(
  p_extension_id uuid, p_expected_version integer, p_provider text, p_environment text, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_ext public.extension_requests;
  v_order public.payment_orders;
  v_attempt_no integer;
begin
  select * into v_ext from public.extension_requests where id = p_extension_id and customer_id = v_actor;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  perform app.lock_booking(v_ext.booking_id);
  select * into v_ext from public.extension_requests where id = p_extension_id for update;
  if v_ext.status = 'EXPIRED' then
    perform app.fail('EXTENSION_EXPIRED');
  end if;
  if v_ext.status not in ('HELD', 'PENDING_PAYMENT') then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_ext.status));
  end if;
  select * into v_order from public.payment_orders
   where extension_id = p_extension_id and state in ('CREATED', 'ORDER_PENDING', 'READY', 'UNKNOWN') for update;
  if found then
    return app.payment_order_json(v_order) || jsonb_build_object('created', false, 'extension_status', v_ext.status,
                                                                 'hold_expires_at', v_ext.hold_expires_at);
  end if;
  if v_ext.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_ext.version));
  end if;
  select coalesce(max(attempt_no), 0) + 1 into v_attempt_no from public.payment_orders where booking_id = v_ext.booking_id;
  insert into public.payment_orders (
    booking_id, venue_id, customer_id, provider, environment, expected_amount_paise, currency, state, operation_key,
    attempt_no, expires_at, extension_id
  ) values (
    v_ext.booking_id, v_ext.venue_id, v_actor, p_provider, p_environment, v_ext.amount_paise, 'INR', 'ORDER_PENDING',
    'order:extension:' || v_ext.id || ':' || v_attempt_no, v_attempt_no, v_ext.hold_expires_at, v_ext.id
  ) returning * into v_order;
  update public.extension_requests set status = 'PENDING_PAYMENT' where id = p_extension_id returning * into v_ext;
  return app.payment_order_json(v_order) || jsonb_build_object('created', true, 'extension_status', v_ext.status,
                                                               'hold_expires_at', v_ext.hold_expires_at);
end;
$$;

create or replace function app.cancel_extension(p_extension_id uuid, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_ext public.extension_requests;
  v_now timestamptz;
begin
  select * into v_ext from public.extension_requests where id = p_extension_id and customer_id = v_actor;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  v_now := app.lock_booking(v_ext.booking_id);
  select * into v_ext from public.extension_requests where id = p_extension_id for update;
  if v_ext.status not in ('REQUESTED', 'APPROVED', 'HELD', 'PENDING_PAYMENT') then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_ext.status));
  end if;
  perform app.end_extension(p_extension_id, 'CANCELLED', v_now, 'CUSTOMER');
  return app.extension_json((select x from public.extension_requests x where x.id = p_extension_id));
end;
$$;

-- Staff desk: open requests at the venue with their deadline and whether they still look possible (no prices).
create or replace function app.staff_extension_requests(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_venue_staff(p_venue_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'extension_id', x.id, 'booking_id', x.booking_id, 'public_ref', b.public_ref, 'resource_label', r.label,
             'additional_minutes', x.additional_minutes, 'original_end_at', x.original_end_at, 'requested_end_at', x.requested_end_at,
             'status', x.status, 'request_expires_at', x.request_expires_at, 'approval_expires_at', x.approval_expires_at,
             'hold_expires_at', x.hold_expires_at, 'version', x.version,
             'feasible', x.status <> 'REQUESTED' or not app.extension_conflict(b, x.requested_end_at)) order by x.created_at)
    from public.extension_requests x
    join public.bookings b on b.id = x.booking_id
    join public.resources r on r.id = b.resource_id
    where x.venue_id = p_venue_id and x.status in ('REQUESTED', 'APPROVED', 'HELD', 'PENDING_PAYMENT')
      and (x.status <> 'REQUESTED' or x.request_expires_at > clock_timestamp())), '[]'::jsonb);
end;
$$;

-- Payment truth: the extension branch. Same locks (lock_booking first, which also expires due extension phases), same
-- evidence rules; an extension is applied only by an exact capture while its hold is still valid.
create or replace function app.apply_payment_observation(
  p_order_id uuid,
  p_provider text,
  p_environment text,
  p_provider_order_id text,
  p_provider_payment_id text,
  p_amount_paise bigint,
  p_currency text,
  p_state text,
  p_captured_at timestamptz,
  p_source text,
  p_provider_event uuid,
  p_token_hash text,
  p_pin_hash text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_order public.payment_orders;
  v_booking public.bookings;
  v_attempt public.payment_attempts;
  v_ext public.extension_requests;
  v_now timestamptz;
  v_rank_old integer;
  v_rank_new integer;
  v_outcome text := 'RECORDED';
  v_reason text;
  v_refund public.refunds;
  v_prev_status text;
  v_differs boolean := false;
  v_evidence text := 'provider:' || p_provider || ':' || p_environment || ':' || p_provider_payment_id;
begin
  if p_state not in ('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'UNKNOWN')
     or p_source not in ('VERIFY', 'WEBHOOK', 'RECONCILE')
     or p_provider_payment_id is null or p_amount_paise is null or p_amount_paise < 0 or p_currency is null then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'observation'));
  end if;

  select * into v_order from public.payment_orders where id = p_order_id;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  v_now := app.lock_booking(v_order.booking_id);
  select * into v_order from public.payment_orders where id = p_order_id for update;
  select * into v_booking from public.bookings where id = v_order.booking_id;
  if v_order.extension_id is not null then
    select * into v_ext from public.extension_requests where id = v_order.extension_id for update;
  end if;

  -- The observation must belong to this exact order, provider and environment.
  if p_provider <> v_order.provider or p_environment <> v_order.environment
     or p_provider_order_id is null
     or (v_order.provider_order_id is not null and p_provider_order_id <> v_order.provider_order_id) then
    insert into public.audit_events (actor_role, action, entity_type, entity_id, venue_id, reason, safe_diff)
    values ('SERVICE', 'payment.mismatched_order', 'payment_order', v_order.id, v_booking.venue_id, 'MISMATCHED_ORDER',
            jsonb_build_object('observed_provider', left(p_provider, 40), 'observed_environment', left(p_environment, 10),
                               'observed_provider_order_id', left(p_provider_order_id, 120),
                               'provider_payment_id', left(p_provider_payment_id, 120), 'source', p_source));
    return jsonb_build_object('outcome', 'MISMATCHED_ORDER', 'booking_id', v_booking.id, 'booking_status', v_booking.status);
  end if;
  if v_order.provider_order_id is null then
    update public.payment_orders set provider_order_id = p_provider_order_id,
           state = case when state in ('ORDER_PENDING', 'UNKNOWN', 'CREATED') then 'READY' else state end,
           creation_lease_until = null
     where id = v_order.id returning * into v_order;
  end if;

  select * into v_attempt from public.payment_attempts
   where provider = p_provider and environment = p_environment and provider_payment_id = p_provider_payment_id
   for update;
  if not found then
    insert into public.payment_attempts (
      payment_order_id, booking_id, provider, environment, provider_payment_id, amount_paise, currency, state,
      captured_at, verified_at
    ) values (
      v_order.id, v_booking.id, p_provider, p_environment, p_provider_payment_id, p_amount_paise, upper(p_currency), p_state,
      case when p_state = 'CAPTURED' then coalesce(p_captured_at, v_now) end, v_now
    ) returning * into v_attempt;
  else
    if v_attempt.payment_order_id <> v_order.id then
      insert into public.audit_events (actor_role, action, entity_type, entity_id, venue_id, reason, safe_diff)
      values ('SERVICE', 'payment.mismatched_order', 'payment_attempt', v_attempt.id, v_booking.venue_id, 'MISMATCHED_ORDER',
              jsonb_build_object('observed_for_order', v_order.id, 'source', p_source));
      return jsonb_build_object('outcome', 'MISMATCHED_ORDER', 'booking_id', v_booking.id, 'booking_status', v_booking.status);
    end if;
    v_differs := v_attempt.amount_paise <> p_amount_paise or v_attempt.currency <> upper(p_currency);
    -- PENDING/UNKNOWN < AUTHORIZED < FAILED < CAPTURED: a reordered or delayed observation never regresses state.
    v_rank_old := case v_attempt.state when 'CAPTURED' then 3 when 'FAILED' then 2 when 'AUTHORIZED' then 1 else 0 end;
    v_rank_new := case p_state when 'CAPTURED' then 3 when 'FAILED' then 2 when 'AUTHORIZED' then 1 else 0 end;
    if v_rank_new > v_rank_old then
      update public.payment_attempts
         set state = p_state, verified_at = v_now,
             captured_at = case when p_state = 'CAPTURED' then coalesce(p_captured_at, v_now) else captured_at end
       where id = v_attempt.id returning * into v_attempt;
    end if;
  end if;

  if not exists (
    select 1 from (
      select e.observed_state, e.amount_paise, e.currency from public.payment_attempt_events e
      where e.payment_attempt_id = v_attempt.id order by e.created_at desc, e.id desc limit 1
    ) last
    where last.observed_state = p_state and last.amount_paise = p_amount_paise and last.currency = upper(p_currency)
  ) then
    insert into public.payment_attempt_events (payment_attempt_id, observed_state, amount_paise, currency, source, provider_event_id)
    values (v_attempt.id, p_state, p_amount_paise, upper(p_currency), p_source, p_provider_event);
  end if;

  if v_differs and v_attempt.allocation_state <> 'UNALLOCATED' then
    insert into public.audit_events (actor_role, action, entity_type, entity_id, venue_id, reason, safe_diff)
    values ('SERVICE', 'payment.observation_mismatch', 'payment_attempt', v_attempt.id, v_booking.venue_id, 'AMOUNT_OR_CURRENCY_CHANGED',
            jsonb_build_object('recorded_paise', v_attempt.amount_paise, 'observed_paise', p_amount_paise,
                               'recorded_currency', v_attempt.currency, 'observed_currency', upper(p_currency)));
  end if;

  if v_attempt.state = 'CAPTURED' and v_attempt.allocation_state = 'UNALLOCATED' then
    if v_differs or v_attempt.currency <> v_order.currency or v_attempt.amount_paise <> v_order.expected_amount_paise then
      -- Wrong or changing amount/currency: never confirms. Held for an operator; the customer is told it is under review.
      update public.payment_attempts set allocation_state = 'QUARANTINED', last_error_code = 'PAYMENT_AMOUNT_MISMATCH'
       where id = v_attempt.id returning * into v_attempt;
      if v_attempt.currency = 'INR' and v_attempt.amount_paise > 0 then
        perform app.post_journal('capture:' || v_attempt.id || ':quarantine', 'CAPTURE_QUARANTINED', v_booking.id, v_attempt.id,
          null, v_evidence, jsonb_build_array(
            jsonb_build_object('account', 'GATEWAY_CLEARING', 'side', 'DEBIT', 'amount_paise', v_attempt.amount_paise),
            jsonb_build_object('account', 'UNALLOCATED_SUSPENSE', 'side', 'CREDIT', 'amount_paise', v_attempt.amount_paise)));
      end if;
      insert into public.booking_events (booking_id, event_type, from_status, to_status, reason_code, business_key, safe_metadata)
      values (v_booking.id, 'PAYMENT_QUARANTINED', v_booking.status, v_booking.status, 'PAYMENT_AMOUNT_MISMATCH',
              'attempt:' || v_attempt.id || ':quarantined',
              jsonb_build_object('expected_paise', v_order.expected_amount_paise, 'observed_paise', p_amount_paise,
                                 'observed_currency', upper(p_currency)));
      insert into public.audit_events (actor_role, action, entity_type, entity_id, venue_id, reason, safe_diff)
      values ('SERVICE', 'payment.quarantine', 'payment_attempt', v_attempt.id, v_booking.venue_id, 'PAYMENT_AMOUNT_MISMATCH',
              jsonb_build_object('booking_id', v_booking.id, 'expected_paise', v_order.expected_amount_paise,
                                 'observed_paise', p_amount_paise));
      v_outcome := 'QUARANTINED';
    elsif v_order.extension_id is null
          and v_booking.status in ('HOLD', 'PENDING_PAYMENT')
          and v_now < v_booking.hold_expires_at
          and exists (select 1 from public.inventory_claims c
                      where c.booking_id = v_booking.id and c.kind = 'BOOKING' and c.active) then
      if p_token_hash is null or p_pin_hash is null then
        perform app.fail('INTERNAL_ERROR', jsonb_build_object('reason', 'arrival_codes_missing'));
      end if;
      update public.payment_attempts set allocation_state = 'BOOKING' where id = v_attempt.id returning * into v_attempt;
      v_prev_status := v_booking.status;
      update public.bookings
         set status = 'CONFIRMED', confirmed_at = v_now, checkin_token_hash = p_token_hash, checkin_pin_hash = p_pin_hash
       where id = v_booking.id returning * into v_booking;
      update public.inventory_claims set expires_at = null
       where booking_id = v_booking.id and kind = 'BOOKING' and active;
      perform app.post_journal('allocation:booking:' || v_booking.id, 'CAPTURE_ALLOCATED_BOOKING', v_booking.id, v_attempt.id,
        null, v_evidence, jsonb_build_array(
          jsonb_build_object('account', 'GATEWAY_CLEARING', 'side', 'DEBIT', 'amount_paise', v_attempt.amount_paise),
          jsonb_build_object('account', 'CUSTOMER_BOOKING_LIABILITY', 'side', 'CREDIT', 'amount_paise', v_attempt.amount_paise)));
      insert into public.booking_events (booking_id, event_type, from_status, to_status, reason_code, business_key, safe_metadata)
      values (v_booking.id, 'CONFIRMED', v_prev_status, 'CONFIRMED',
              'VERIFIED_CAPTURE', 'booking:' || v_booking.id || ':confirmed',
              jsonb_build_object('payment_attempt_id', v_attempt.id, 'source', p_source));
      perform app.enqueue_job('booking:' || v_booking.id || ':confirmed', 'booking.confirmed',
                              jsonb_build_object('booking_id', v_booking.id));
      v_outcome := 'CONFIRMED';
    elsif v_order.extension_id is not null
          and v_ext.status in ('HELD', 'PENDING_PAYMENT')
          and v_now < v_ext.hold_expires_at
          and v_booking.status = 'CHECKED_IN' then
      -- Timely, exact extension capture: the end moves; the claim was already widened by the hold.
      update public.payment_attempts set allocation_state = 'EXTENSION' where id = v_attempt.id returning * into v_attempt;
      update public.bookings set end_at = v_ext.requested_end_at where id = v_booking.id returning * into v_booking;
      update public.extension_requests set status = 'APPLIED', applied_at = v_now where id = v_ext.id returning * into v_ext;
      perform app.post_journal('allocation:extension:' || v_ext.id, 'CAPTURE_ALLOCATED_EXTENSION', v_booking.id, v_attempt.id,
        null, v_evidence, jsonb_build_array(
          jsonb_build_object('account', 'GATEWAY_CLEARING', 'side', 'DEBIT', 'amount_paise', v_attempt.amount_paise),
          jsonb_build_object('account', 'CUSTOMER_BOOKING_LIABILITY', 'side', 'CREDIT', 'amount_paise', v_attempt.amount_paise)));
      insert into public.booking_events (booking_id, event_type, from_status, to_status, reason_code, business_key, safe_metadata)
      values (v_booking.id, 'EXTENDED', v_booking.status, v_booking.status, 'VERIFIED_CAPTURE',
              'extension:' || v_ext.id || ':applied',
              jsonb_build_object('extension_id', v_ext.id, 'payment_attempt_id', v_attempt.id, 'new_end_at', v_ext.requested_end_at,
                                 'source', p_source));
      perform app.enqueue_job('extension:' || v_ext.id || ':applied', 'extension.notify',
                              jsonb_build_object('booking_id', v_booking.id, 'extension_id', v_ext.id, 'event', 'APPLIED'));
      v_outcome := 'EXTENDED';
    else
      -- Captured money with nothing to allocate to: expired/cancelled hold or extension, or a second capture for
      -- something already paid. Full refund liability; the booking and any replacement booking are untouched.
      v_reason := case
        when v_order.extension_id is not null then case when v_ext.status = 'APPLIED' then 'DUPLICATE_CAPTURE' else 'LATE_CAPTURE' end
        when v_booking.status = 'CANCELLED' then 'CANCELLED_HOLD_CAPTURE'
        when v_booking.status in ('CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW') then 'DUPLICATE_CAPTURE'
        else 'LATE_CAPTURE' end;
      update public.payment_attempts set allocation_state = 'REFUND_DUE', last_error_code = v_reason
       where id = v_attempt.id returning * into v_attempt;
      if v_attempt.currency = 'INR' and v_attempt.amount_paise > 0 then
        perform app.post_journal('capture:' || v_attempt.id || ':refund_due', 'CAPTURE_REFUND_DUE', v_booking.id, v_attempt.id,
          null, v_evidence, jsonb_build_array(
            jsonb_build_object('account', 'GATEWAY_CLEARING', 'side', 'DEBIT', 'amount_paise', v_attempt.amount_paise),
            jsonb_build_object('account', 'CUSTOMER_REFUND_LIABILITY', 'side', 'CREDIT', 'amount_paise', v_attempt.amount_paise)));
        insert into public.refunds (payment_attempt_id, booking_id, amount_paise, currency, reason_code, operation_key)
        values (v_attempt.id, v_booking.id, v_attempt.amount_paise, 'INR', v_reason, 'refund:attempt:' || v_attempt.id || ':full')
        returning * into v_refund;
        perform app.enqueue_job('refund:' || v_refund.id || ':submit', 'refund.submit', jsonb_build_object('refund_id', v_refund.id));
        perform app.enqueue_job('refund:' || v_refund.id || ':requested', 'refund.requested',
                                jsonb_build_object('booking_id', v_booking.id, 'refund_id', v_refund.id));
      end if;
      insert into public.booking_events (booking_id, event_type, from_status, to_status, reason_code, business_key, safe_metadata)
      values (v_booking.id, 'CAPTURE_REFUND_DUE', v_booking.status, v_booking.status, v_reason,
              'attempt:' || v_attempt.id || ':refund_due',
              jsonb_build_object('payment_attempt_id', v_attempt.id, 'amount_paise', v_attempt.amount_paise, 'source', p_source,
                                 'extension_id', v_order.extension_id));
      v_outcome := 'REFUND_DUE';
    end if;
  end if;

  return jsonb_build_object(
    'outcome', v_outcome,
    'booking_id', v_booking.id,
    'booking_status', v_booking.status,
    'extension_id', v_order.extension_id,
    'extension_status', v_ext.status,
    'attempt_id', v_attempt.id,
    'attempt_state', v_attempt.state,
    'allocation_state', v_attempt.allocation_state);
end;
$$;

-- The booking's own payment (extension orders are reported with the extension).
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
      from public.payment_attempts a join public.payment_orders ao on ao.id = a.payment_order_id
      where a.booking_id = p_booking_id and ao.extension_id is null),
    'failed_attempts', (select count(*) from public.payment_attempts a where a.payment_order_id = o.id and a.state = 'FAILED'),
    'open_attempts', (select count(*) from public.payment_attempts a join public.payment_orders ao on ao.id = a.payment_order_id
                      where a.booking_id = p_booking_id and ao.extension_id is null and a.state in ('PENDING', 'AUTHORIZED', 'UNKNOWN')))
  from public.payment_orders o
  where o.booking_id = p_booking_id and o.extension_id is null
  order by o.attempt_no desc
  limit 1;
$$;

create or replace function app.payment_order_json(p_order public.payment_orders)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'payment_order_id', p_order.id,
    'booking_id', p_order.booking_id,
    'extension_id', p_order.extension_id,
    'state', p_order.state,
    'provider', p_order.provider,
    'environment', p_order.environment,
    'provider_order_id', p_order.provider_order_id,
    'operation_key', p_order.operation_key,
    'expected_amount_paise', p_order.expected_amount_paise,
    'currency', p_order.currency,
    'expires_at', p_order.expires_at,
    'version', p_order.version);
$$;

-- Check-out ends any open extension (claim shrinks back; a later capture becomes a refund).
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
  v_ext uuid;
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
  for v_ext in select id from public.extension_requests where booking_id = p_booking_id
               and status in ('REQUESTED', 'APPROVED', 'HELD', 'PENDING_PAYMENT') loop
    perform app.end_extension(v_ext, 'CANCELLED', v_now, 'CHECKED_OUT');
  end loop;
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

-- Live extension orders are reconciled every minute (their hold lasts at most five).
create or replace function app.orders_to_reconcile(p_limit integer default 20)
returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  return query
  update public.payment_orders o
     set reconciled_at = v_now
    from public.bookings b
   where b.id = o.booking_id
     and o.id in (
       select o2.id
       from public.payment_orders o2
       join public.bookings b2 on b2.id = o2.booking_id
       left join public.extension_requests x2 on x2.id = o2.extension_id
       where (o2.creation_lease_until is null or o2.creation_lease_until <= v_now)
         and (
           (o2.state = 'UNKNOWN' and (o2.reconciled_at is null or o2.reconciled_at < v_now - interval '30 seconds'))
           or (o2.state = 'ORDER_PENDING' and o2.updated_at < v_now - interval '2 minutes'
               and (o2.reconciled_at is null or o2.reconciled_at < v_now - interval '30 seconds'))
           or (o2.state = 'READY' and o2.extension_id is null and b2.status in ('HOLD', 'PENDING_PAYMENT')
               and o2.created_at < v_now - interval '1 minute'
               and (o2.reconciled_at is null or o2.reconciled_at < v_now - interval '1 minute'))
           or (o2.state = 'READY' and o2.extension_id is not null and x2.status in ('HELD', 'PENDING_PAYMENT')
               and o2.created_at < v_now - interval '1 minute'
               and (o2.reconciled_at is null or o2.reconciled_at < v_now - interval '1 minute'))
           or (o2.state = 'READY' and b2.status not in ('HOLD', 'PENDING_PAYMENT')
               and b2.confirmed_at > v_now - interval '24 hours'
               and (o2.reconciled_at is null or o2.reconciled_at < v_now - interval '15 minutes'))
           or (o2.state = 'EXPIRED' and o2.provider_order_id is not null and o2.updated_at > v_now - interval '24 hours'
               and (o2.reconciled_at is null or o2.reconciled_at < v_now - interval '10 minutes'))
         )
       order by o2.reconciled_at nulls first, o2.created_at
       for update of o2 skip locked
       limit greatest(1, least(p_limit, 100))
     )
  returning app.payment_order_json(o) || jsonb_build_object('booking_status', b.status);
end;
$$;

-- Customer projection: latest extension and applied extensions with their amounts.
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
    'cancel_reason', p_booking.cancel_reason,
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
    'extension', (select app.extension_json(x) from public.extension_requests x where x.booking_id = p_booking.id
                  order by x.created_at desc limit 1),
    'extensions_applied', coalesce((select jsonb_agg(jsonb_build_object('extension_id', x.id, 'additional_minutes', x.additional_minutes,
                                                                        'amount_paise', x.amount_paise, 'applied_at', x.applied_at)
                                                     order by x.applied_at)
                                    from public.extension_requests x where x.booking_id = p_booking.id and x.status = 'APPLIED'), '[]'::jsonb),
    'server_now', clock_timestamp());
$$;

grant execute on function
  app.request_extension(uuid, integer, integer, uuid),
  app.decide_extension(uuid, text, text, integer, uuid),
  app.hold_extension(uuid, bigint, integer, uuid),
  app.begin_extension_checkout(uuid, integer, text, text, uuid),
  app.cancel_extension(uuid, uuid),
  app.staff_extension_requests(uuid)
  to authenticated;
-- Internal: extension_price, extension_json, end_extension, extension_conflict, extension_fits_hours.
revoke execute on all functions in schema app from public;
