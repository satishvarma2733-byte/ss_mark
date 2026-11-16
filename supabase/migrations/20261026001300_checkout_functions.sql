-- M3 checkout, payment verification, refund liability and recovery (docs/07 s.3, 5, 7, 8; docs/02 s.6).
-- Lock order everywhere: venue -> resource -> booking -> payment order -> payment attempt.
-- Only app.apply_payment_observation can confirm a booking. It is granted to nobody and reached through
-- app.process_payment_observation, which only the worker role may execute (the API switches to that role after it
-- has fetched the payment from the gateway itself). A client token can never record a capture.

create or replace function app.is_worker()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_setting('role', true) = 'simply_worker';
$$;

-- Expire due holds on one resource and close their payment orders. Caller holds the venue and resource locks.
-- A capture that arrives later becomes a refund liability (app.apply_payment_observation); it never revives the hold.
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
    update public.payment_orders set state = 'EXPIRED', last_error_code = coalesce(last_error_code, 'HOLD_EXPIRED')
      where booking_id = b.id and state in ('CREATED', 'ORDER_PENDING', 'READY', 'UNKNOWN');
    insert into public.booking_events (booking_id, event_type, from_status, to_status, reason_code, business_key)
      values (b.id, 'HOLD_EXPIRED', b.status, 'EXPIRED', 'HOLD_DEADLINE', 'booking:' || b.id || ':expired');
    perform app.enqueue_job('booking:' || b.id || ':hold_expired', 'booking.hold_expired',
                            jsonb_build_object('booking_id', b.id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Locks venue -> resource -> booking for an existing booking, then expires due holds on that resource.
-- Returns the clock sampled after the locks (docs/02 s.4).
create or replace function app.lock_booking(p_booking_id uuid)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  v_venue uuid;
  v_resource uuid;
  v_now timestamptz;
begin
  select venue_id, resource_id into v_venue, v_resource from public.bookings where id = p_booking_id;
  if v_venue is null then
    perform app.fail('NOT_FOUND');
  end if;
  perform 1 from public.venues where id = v_venue for update;
  perform 1 from public.resources where id = v_resource for update;
  perform 1 from public.bookings where id = p_booking_id for update;
  v_now := clock_timestamp();
  perform app.expire_resource_holds(v_resource, v_now);
  return v_now;
end;
$$;

-- POST /booking-holds (M2) with review fix R2: the CURRENT terms version must be accepted.
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
  v_quote public.quotes;
  v_venue public.venues;
  v_resource public.resources;
  v_policy public.venue_policies;
  v_rate_version integer;
  v_now timestamptz;
  v_booking public.bookings;
begin
  perform app.require_current_terms(v_actor);

  select * into v_quote from public.quotes where id = p_quote_id and customer_id = v_actor;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;

  -- Lock order: venue -> resource -> quote/booking rows.
  select * into v_venue from public.venues where id = v_quote.venue_id for update;
  select * into v_resource from public.resources where id = v_quote.resource_id and venue_id = v_venue.id for update;
  select * into v_quote from public.quotes where id = p_quote_id for update;
  v_now := clock_timestamp();

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

-- Customer abandons an unpaid hold (review fix R3): expire first if due, record the true previous status, close
-- the payment order. A capture that still arrives becomes a refund liability.
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
  v_from text;
begin
  if not exists (select 1 from public.bookings where id = p_booking_id and customer_id = v_actor) then
    perform app.fail('NOT_FOUND');
  end if;
  v_now := app.lock_booking(p_booking_id);
  select * into v_booking from public.bookings where id = p_booking_id;

  if v_booking.status = 'EXPIRED' then
    perform app.fail('HOLD_EXPIRED');
  end if;
  if v_booking.status not in ('HOLD', 'PENDING_PAYMENT') then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_booking.status));
  end if;
  if v_booking.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_booking.version, 'status', v_booking.status));
  end if;

  v_from := v_booking.status;
  update public.bookings set status = 'CANCELLED', cancelled_at = v_now, cancel_reason = 'CUSTOMER_ABANDONED'
    where id = v_booking.id returning * into v_booking;
  update public.inventory_claims set active = false, released_at = v_now
    where booking_id = v_booking.id and kind = 'BOOKING' and active;
  update public.payment_orders set state = 'EXPIRED', last_error_code = 'BOOKING_CANCELLED'
    where booking_id = v_booking.id and state in ('CREATED', 'ORDER_PENDING', 'READY', 'UNKNOWN');
  insert into public.booking_events (booking_id, actor_id, event_type, from_status, to_status, reason_code, request_id)
    values (v_booking.id, v_actor, 'HOLD_CANCELLED', v_from, 'CANCELLED', 'CUSTOMER_ABANDONED', p_request_id);

  return jsonb_build_object('booking_id', v_booking.id, 'status', v_booking.status, 'version', v_booking.version);
end;
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

-- POST /bookings/{id}/checkout, step 1: persist the expected payment before any provider call (docs/07 s.3).
-- Returns the existing active order when there is one, so a repeated Pay never creates a second order.
create or replace function app.begin_checkout(
  p_booking_id uuid, p_expected_version integer, p_provider text, p_environment text, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_booking public.bookings;
  v_order public.payment_orders;
  v_attempt_no integer;
  v_from text;
begin
  if not exists (select 1 from public.bookings where id = p_booking_id and customer_id = v_actor) then
    perform app.fail('NOT_FOUND');
  end if;
  perform app.lock_booking(p_booking_id);
  select * into v_booking from public.bookings where id = p_booking_id;

  if v_booking.status = 'EXPIRED' then
    perform app.fail('HOLD_EXPIRED');
  end if;
  if v_booking.status not in ('HOLD', 'PENDING_PAYMENT') then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_booking.status));
  end if;

  select * into v_order from public.payment_orders
   where booking_id = v_booking.id and state in ('CREATED', 'ORDER_PENDING', 'READY', 'UNKNOWN')
   for update;
  if found then
    return app.payment_order_json(v_order)
      || jsonb_build_object('created', false, 'booking_status', v_booking.status, 'booking_version', v_booking.version,
                            'hold_expires_at', v_booking.hold_expires_at);
  end if;

  if v_booking.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_booking.version, 'status', v_booking.status));
  end if;

  select coalesce(max(attempt_no), 0) + 1 into v_attempt_no from public.payment_orders where booking_id = v_booking.id;
  insert into public.payment_orders (
    booking_id, venue_id, customer_id, provider, environment, expected_amount_paise, currency, state, operation_key,
    attempt_no, expires_at
  ) values (
    v_booking.id, v_booking.venue_id, v_actor, p_provider, p_environment, v_booking.total_paise, v_booking.currency,
    'ORDER_PENDING', 'order:booking:' || v_booking.id || ':' || v_attempt_no, v_attempt_no, v_booking.hold_expires_at
  ) returning * into v_order;

  v_from := v_booking.status;
  if v_booking.status = 'HOLD' then
    update public.bookings set status = 'PENDING_PAYMENT' where id = v_booking.id returning * into v_booking;
  end if;
  insert into public.booking_events (booking_id, actor_id, event_type, from_status, to_status, request_id, safe_metadata)
    values (v_booking.id, v_actor, 'CHECKOUT_STARTED', v_from, v_booking.status, p_request_id,
            jsonb_build_object('payment_order_id', v_order.id, 'amount_paise', v_order.expected_amount_paise));

  return app.payment_order_json(v_order)
    || jsonb_build_object('created', true, 'booking_status', v_booking.status, 'booking_version', v_booking.version,
                          'hold_expires_at', v_booking.hold_expires_at);
end;
$$;

-- Worker-role: lease the provider order creation so concurrent Pay requests do not create two external orders.
create or replace function app.claim_order_creation(p_order_id uuid, p_lease_seconds integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.payment_orders;
begin
  update public.payment_orders
     set creation_lease_until = clock_timestamp() + make_interval(secs => greatest(5, least(p_lease_seconds, 120)))
   where id = p_order_id
     and state in ('ORDER_PENDING', 'UNKNOWN')
     and provider_order_id is null
     and (creation_lease_until is null or creation_lease_until <= clock_timestamp())
  returning * into v_order;
  if not found then
    select * into v_order from public.payment_orders where id = p_order_id;
    if not found then
      perform app.fail('NOT_FOUND');
    end if;
    return app.payment_order_json(v_order) || jsonb_build_object('claimed', false);
  end if;
  return app.payment_order_json(v_order) || jsonb_build_object('claimed', true);
end;
$$;

-- Worker-role: the provider confirmed the order exists. READY only while the hold is usable; an EXPIRED order still
-- records its provider reference so late payments can be reconciled.
create or replace function app.record_provider_order(p_order_id uuid, p_provider_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.payment_orders;
begin
  if p_provider_order_id is null or char_length(p_provider_order_id) not between 1 and 120 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'provider_order_id'));
  end if;
  select * into v_order from public.payment_orders where id = p_order_id for update;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  if v_order.provider_order_id is not null then
    if v_order.provider_order_id <> p_provider_order_id then
      perform app.fail('INTERNAL_ERROR', jsonb_build_object('reason', 'provider_order_mismatch'));
    end if;
    return app.payment_order_json(v_order);
  end if;
  update public.payment_orders
     set provider_order_id = p_provider_order_id,
         state = case when state in ('ORDER_PENDING', 'UNKNOWN', 'CREATED') then 'READY' else state end,
         creation_lease_until = null, last_error_code = null
   where id = p_order_id
  returning * into v_order;
  return app.payment_order_json(v_order);
end;
$$;

-- Worker-role: provider order creation timed out or failed ambiguously. Never assume it does not exist.
create or replace function app.record_order_creation_unknown(p_order_id uuid, p_error_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.payment_orders;
begin
  update public.payment_orders
     set state = case when state = 'ORDER_PENDING' then 'UNKNOWN' else state end,
         creation_lease_until = null, last_error_code = left(coalesce(p_error_code, 'PROVIDER_UNKNOWN'), 60)
   where id = p_order_id and provider_order_id is null
  returning * into v_order;
  if not found then
    select * into v_order from public.payment_orders where id = p_order_id;
  end if;
  return app.payment_order_json(v_order);
end;
$$;

-- The single confirmation path. NOT granted to any role; see app.process_payment_observation.
-- p_state is the provider's authoritative state for one payment, fetched by the server (never client-reported).
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
  v_now timestamptz;
  v_rank_old integer;
  v_rank_new integer;
  v_outcome text := 'RECORDED';
  v_reason text;
  v_refund public.refunds;
  v_prev_status text;
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

  -- The observation must belong to this exact order, provider and environment.
  if p_provider <> v_order.provider or p_environment <> v_order.environment
     or p_provider_order_id is null
     or (v_order.provider_order_id is not null and p_provider_order_id <> v_order.provider_order_id) then
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
      return jsonb_build_object('outcome', 'MISMATCHED_ORDER', 'booking_id', v_booking.id, 'booking_status', v_booking.status);
    end if;
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
  insert into public.payment_attempt_events (payment_attempt_id, observed_state, amount_paise, currency, source, provider_event_id)
  values (v_attempt.id, p_state, p_amount_paise, upper(p_currency), p_source, p_provider_event);

  if v_attempt.state = 'CAPTURED' and v_attempt.allocation_state = 'UNALLOCATED' then
    if v_attempt.currency <> v_order.currency or v_attempt.amount_paise <> v_order.expected_amount_paise then
      -- Wrong amount or currency: never confirms. Held for an operator; the customer is told the payment is under review.
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
              jsonb_build_object('expected_paise', v_order.expected_amount_paise, 'observed_paise', v_attempt.amount_paise,
                                 'observed_currency', v_attempt.currency));
      insert into public.audit_events (actor_role, action, entity_type, entity_id, venue_id, reason, safe_diff)
      values ('SERVICE', 'payment.quarantine', 'payment_attempt', v_attempt.id, v_booking.venue_id, 'PAYMENT_AMOUNT_MISMATCH',
              jsonb_build_object('booking_id', v_booking.id, 'expected_paise', v_order.expected_amount_paise,
                                 'observed_paise', v_attempt.amount_paise));
      v_outcome := 'QUARANTINED';
    elsif v_booking.status in ('HOLD', 'PENDING_PAYMENT')
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
    else
      -- Captured money with nothing to allocate to: expired/cancelled hold, or a second capture for a booking that is
      -- already paid. Full refund liability; the booking and any replacement booking are untouched (docs/07 s.8).
      v_reason := case
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
              jsonb_build_object('payment_attempt_id', v_attempt.id, 'amount_paise', v_attempt.amount_paise, 'source', p_source));
      v_outcome := 'REFUND_DUE';
    end if;
  end if;

  return jsonb_build_object(
    'outcome', v_outcome,
    'booking_id', v_booking.id,
    'booking_status', v_booking.status,
    'attempt_id', v_attempt.id,
    'attempt_state', v_attempt.state,
    'allocation_state', v_attempt.allocation_state);
end;
$$;

-- Worker-role entry point for webhooks, reconciliation and the server-side verify step.
create or replace function app.process_payment_observation(
  p_order_id uuid, p_provider text, p_environment text, p_provider_order_id text, p_provider_payment_id text,
  p_amount_paise bigint, p_currency text, p_state text, p_captured_at timestamptz, p_source text,
  p_provider_event uuid, p_token_hash text, p_pin_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_worker() then
    perform app.fail('FORBIDDEN');
  end if;
  return app.apply_payment_observation(p_order_id, p_provider, p_environment, p_provider_order_id, p_provider_payment_id,
    p_amount_paise, p_currency, p_state, p_captured_at, p_source, p_provider_event, p_token_hash, p_pin_hash);
end;
$$;

-- Worker-role: find our order for a provider order reference (webhook routing).
create or replace function app.find_payment_order(p_provider text, p_environment text, p_provider_order_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.payment_order_json(o) from public.payment_orders o
  where o.provider = p_provider and o.environment = p_environment and o.provider_order_id = p_provider_order_id;
$$;

create or replace function app.get_payment_order(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.payment_order_json(o) from public.payment_orders o where o.id = p_order_id;
$$;

-- POST /webhooks/{provider}: the route has verified the signature over the raw body. Durable, deduplicated ingestion
-- and the processing job commit together; a duplicate delivery returns the original row.
create or replace function app.ingest_provider_event(
  p_provider text, p_environment text, p_event_id text, p_event_type text, p_safe_payload jsonb, p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.provider_events (provider, environment, event_id, event_type, safe_payload, payload_hash)
  values (p_provider, p_environment, p_event_id, p_event_type, coalesce(p_safe_payload, '{}'::jsonb), p_payload_hash)
  on conflict (provider, environment, event_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.provider_events
     where provider = p_provider and environment = p_environment and event_id = p_event_id;
    return jsonb_build_object('event_row_id', v_id, 'duplicate', true);
  end if;
  perform app.enqueue_job('provider_event:' || v_id, 'payment.provider_event', jsonb_build_object('event_row_id', v_id));
  return jsonb_build_object('event_row_id', v_id, 'duplicate', false);
end;
$$;

create or replace function app.get_provider_event(p_event_row_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', e.id, 'provider', e.provider, 'environment', e.environment, 'event_id', e.event_id,
                            'event_type', e.event_type, 'safe_payload', e.safe_payload, 'status', e.status)
  from public.provider_events e where e.id = p_event_row_id;
$$;

create or replace function app.mark_provider_event(p_event_row_id uuid, p_status text, p_error_code text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('PROCESSED', 'RETRY', 'QUARANTINED') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'status'));
  end if;
  update public.provider_events
     set status = p_status, attempts = attempts + 1, last_error_code = left(p_error_code, 60),
         processed_at = case when p_status = 'PROCESSED' then clock_timestamp() else processed_at end
   where id = p_event_row_id and status <> 'PROCESSED';
end;
$$;

-- Reconciliation candidates: uncertain creations, stale pending creations, and orders that may hold a payment we have
-- not heard about (missing or delayed webhooks), including recently expired ones (late captures).
create or replace function app.orders_to_reconcile(p_limit integer default 20)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.payment_order_json(o) || jsonb_build_object('booking_status', b.status)
  from public.payment_orders o
  join public.bookings b on b.id = o.booking_id
  where (
      o.state = 'UNKNOWN'
      or (o.state = 'ORDER_PENDING' and o.updated_at < clock_timestamp() - interval '2 minutes')
      or (o.state = 'READY' and (o.reconciled_at is null or o.reconciled_at < clock_timestamp() - interval '1 minute')
          and o.created_at < clock_timestamp() - interval '1 minute')
      or (o.state = 'EXPIRED' and o.provider_order_id is not null and o.updated_at > clock_timestamp() - interval '24 hours'
          and (o.reconciled_at is null or o.reconciled_at < clock_timestamp() - interval '5 minutes'))
    )
    and (o.creation_lease_until is null or o.creation_lease_until <= clock_timestamp())
  order by o.reconciled_at nulls first, o.created_at
  limit greatest(1, least(p_limit, 100));
$$;

create or replace function app.mark_order_reconciled(p_order_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payment_orders set reconciled_at = clock_timestamp() where id = p_order_id;
$$;

-- Refund submission (worker). The operation key is the provider idempotency key; retries reuse it.
create or replace function app.refund_for_submission(p_refund_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('refund_id', r.id, 'status', r.status, 'amount_paise', r.amount_paise, 'currency', r.currency,
                            'operation_key', r.operation_key, 'provider', a.provider, 'environment', a.environment,
                            'provider_payment_id', a.provider_payment_id, 'provider_refund_id', r.provider_refund_id)
  from public.refunds r join public.payment_attempts a on a.id = r.payment_attempt_id
  where r.id = p_refund_id;
$$;

create or replace function app.record_refund_result(
  p_refund_id uuid, p_status text, p_provider_refund_id text, p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refund public.refunds;
begin
  if p_status not in ('PROCESSING', 'PROCESSED', 'FAILED', 'UNKNOWN') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'status'));
  end if;
  select * into v_refund from public.refunds where id = p_refund_id for update;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  if v_refund.status in ('PROCESSED', 'FAILED') then
    return jsonb_build_object('refund_id', v_refund.id, 'status', v_refund.status, 'changed', false);
  end if;
  update public.refunds
     set status = p_status,
         provider_refund_id = coalesce(provider_refund_id, p_provider_refund_id),
         processed_at = case when p_status = 'PROCESSED' then clock_timestamp() else processed_at end,
         last_error_code = left(p_error_code, 60)
   where id = p_refund_id returning * into v_refund;
  if p_status = 'PROCESSED' then
    update public.payment_attempts set allocation_state = 'REFUNDED'
     where id = v_refund.payment_attempt_id and allocation_state = 'REFUND_DUE'
       and (select coalesce(sum(amount_paise), 0) from public.refunds
             where payment_attempt_id = v_refund.payment_attempt_id and status = 'PROCESSED') >= amount_paise;
    perform app.post_journal('refund:' || v_refund.id || ':processed', 'REFUND_PROCESSED', v_refund.booking_id,
      v_refund.payment_attempt_id, v_refund.id, 'provider_refund:' || v_refund.provider_refund_id, jsonb_build_array(
        jsonb_build_object('account', 'CUSTOMER_REFUND_LIABILITY', 'side', 'DEBIT', 'amount_paise', v_refund.amount_paise),
        jsonb_build_object('account', 'GATEWAY_CLEARING', 'side', 'CREDIT', 'amount_paise', v_refund.amount_paise)));
    insert into public.booking_events (booking_id, event_type, reason_code, business_key, safe_metadata)
    values (v_refund.booking_id, 'REFUND_PROCESSED', v_refund.reason_code, 'refund:' || v_refund.id || ':processed',
            jsonb_build_object('refund_id', v_refund.id, 'amount_paise', v_refund.amount_paise));
  end if;
  return jsonb_build_object('refund_id', v_refund.id, 'status', v_refund.status, 'changed', true);
end;
$$;

-- Notification handler shared by confirmation and refund jobs: one in-app and one email per event key (idempotent).
create or replace function app.job_notify_booking(p_booking_id uuid, p_event_key text, p_template text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
  v_email_id uuid;
  v_status text;
begin
  select customer_id into v_customer from public.bookings where id = p_booking_id;
  if v_customer is null then
    return 0;
  end if;
  insert into public.notifications (user_id, booking_id, event_key, channel, template)
  values (v_customer, p_booking_id, p_event_key, 'IN_APP', p_template),
         (v_customer, p_booking_id, p_event_key, 'EMAIL', p_template)
  on conflict (event_key, user_id, channel) do nothing;
  select id, status into v_email_id, v_status from public.notifications
   where event_key = p_event_key and user_id = v_customer and channel = 'EMAIL';
  if v_status = 'QUEUED' then
    perform app.enqueue_job('notification:' || v_email_id || ':email', 'notification.email',
                            jsonb_build_object('notification_id', v_email_id));
    return 1;
  end if;
  return 0;
end;
$$;

-- Booking IDs whose confirmation needs arrival codes: the server derives token/PIN hashes from the booking ID with its
-- secret before calling app.process_payment_observation, so the database never sees the codes themselves.
create or replace function app.booking_for_order(p_order_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select booking_id from public.payment_orders where id = p_order_id;
$$;
