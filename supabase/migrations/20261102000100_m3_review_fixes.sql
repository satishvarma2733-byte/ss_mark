-- M3 independent review fixes (tasks/current/REVIEW.md, 2 Nov 2026). Finding IDs in comments.

-- F1 + F17: reconciliation selects only orders that can still change a customer outcome, paces each kind, and claims
-- its batch (reconciled_at set under FOR UPDATE SKIP LOCKED) so parallel workers never fetch the same orders.
--   UNKNOWN / stale ORDER_PENDING  every 30 s     (uncertain creation)
--   READY on a live hold           every 1 min    (missing or delayed webhook)
--   READY, booking confirmed <24 h every 15 min   (a duplicate capture becomes a refund liability)
--   EXPIRED with a provider order  every 10 min for 24 h (late captures)
-- Paid bookings older than 24 hours are no longer polled; late provider events still arrive as webhooks.
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
       where (o2.creation_lease_until is null or o2.creation_lease_until <= v_now)
         and (
           (o2.state = 'UNKNOWN' and (o2.reconciled_at is null or o2.reconciled_at < v_now - interval '30 seconds'))
           or (o2.state = 'ORDER_PENDING' and o2.updated_at < v_now - interval '2 minutes'
               and (o2.reconciled_at is null or o2.reconciled_at < v_now - interval '30 seconds'))
           or (o2.state = 'READY' and b2.status in ('HOLD', 'PENDING_PAYMENT')
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

-- F1 + F12: observations are stored only when they differ from the last one seen for that attempt (no unbounded
-- growth from polling); a later observation whose amount or currency differs from the recorded attempt is kept as
-- evidence and quarantines unallocated money instead of confirming it; MISMATCHED_ORDER observations are audited.
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

-- F2: refunds whose submission stalled (job dead or finished without a final provider answer) are picked up again and
-- re-submitted with the SAME operation key, so a provider that already refunded returns that refund, not a new one.
alter table public.refunds add column reconciled_at timestamptz;

create or replace function app.refunds_to_reconcile(p_limit integer default 20)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  return query
  update public.refunds r
     set reconciled_at = v_now
   where r.id in (
     select r2.id from public.refunds r2
     where r2.status in ('REQUESTED', 'PROCESSING', 'UNKNOWN')
       and r2.created_at < v_now - interval '2 minutes'
       and (r2.reconciled_at is null or r2.reconciled_at < v_now - interval '5 minutes')
       and not exists (
         select 1 from public.outbox_jobs j
         where j.business_key = 'refund:' || r2.id || ':submit' and j.status in ('READY', 'LEASED'))
     order by r2.reconciled_at nulls first, r2.created_at
     for update of r2 skip locked
     limit greatest(1, least(p_limit, 100))
   )
  returning r.id;
end;
$$;

-- F3: lock order venue -> resource -> booking -> refund -> attempt (as apply_payment_observation), so a refund result
-- and a re-observation of the same payment cannot deadlock. F2: a FAILED refund is audited and stays visible.
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
  v_booking_id uuid;
  v_venue_id uuid;
begin
  if p_status not in ('PROCESSING', 'PROCESSED', 'FAILED', 'UNKNOWN') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'status'));
  end if;
  select booking_id into v_booking_id from public.refunds where id = p_refund_id;
  if v_booking_id is null then
    perform app.fail('NOT_FOUND');
  end if;
  perform app.lock_booking(v_booking_id);
  select * into v_refund from public.refunds where id = p_refund_id for update;
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
  elsif p_status = 'FAILED' then
    -- The liability is still owed: an operator must act (M4 finance queue). Visible in queue metrics.
    select venue_id into v_venue_id from public.bookings where id = v_refund.booking_id;
    insert into public.audit_events (actor_role, action, entity_type, entity_id, venue_id, reason, safe_diff)
    values ('SERVICE', 'refund.failed', 'refund', v_refund.id, v_venue_id, left(coalesce(p_error_code, 'PROVIDER_FAILED'), 60),
            jsonb_build_object('booking_id', v_refund.booking_id, 'amount_paise', v_refund.amount_paise));
  end if;
  return jsonb_build_object('refund_id', v_refund.id, 'status', v_refund.status, 'changed', true);
end;
$$;

-- F2 (alerting signal): queue metrics also report refunds that are open, stalled or failed.
create or replace function app.queue_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.has_platform_role(array['SUPERADMIN', 'SUPPORT']) then
    perform app.fail('FORBIDDEN');
  end if;
  perform app.require_aal2();
  return jsonb_build_object(
    'ready', (select count(*) from public.outbox_jobs where status = 'READY'),
    'leased', (select count(*) from public.outbox_jobs where status = 'LEASED'),
    'dead', (select count(*) from public.outbox_jobs where status = 'DEAD'),
    'oldest_ready_age_seconds', (
      select coalesce(extract(epoch from clock_timestamp() - min(available_at))::integer, 0)
      from public.outbox_jobs where status = 'READY' and available_at <= clock_timestamp()),
    'due_holds', (select count(*) from public.bookings
                  where status in ('HOLD', 'PENDING_PAYMENT') and hold_expires_at <= clock_timestamp()),
    'refunds_open', (select count(*) from public.refunds where status in ('REQUESTED', 'PROCESSING', 'UNKNOWN')),
    'refunds_stalled', (select count(*) from public.refunds
                        where status in ('REQUESTED', 'PROCESSING', 'UNKNOWN') and created_at < clock_timestamp() - interval '1 hour'),
    'refunds_failed', (select count(*) from public.refunds where status = 'FAILED'),
    'payments_quarantined', (select count(*) from public.payment_attempts where allocation_state = 'QUARANTINED'),
    'workers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'worker_id', h.worker_id, 'last_seen_at', h.last_seen_at, 'ticks', h.ticks,
        'jobs_completed', h.jobs_completed, 'jobs_failed', h.jobs_failed, 'holds_expired', h.holds_expired,
        'last_error_code', h.last_error_code) order by h.last_seen_at desc)
      from public.worker_heartbeats h), '[]'::jsonb));
end;
$$;

-- F9: the payment summary reports attempts still in flight, so an ended hold with a pending payment is not "settled".
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
    'failed_attempts', (select count(*) from public.payment_attempts a where a.payment_order_id = o.id and a.state = 'FAILED'),
    'open_attempts', (select count(*) from public.payment_attempts a
                      where a.booking_id = p_booking_id and a.state in ('PENDING', 'AUTHORIZED', 'UNKNOWN')))
  from public.payment_orders o
  where o.booking_id = p_booking_id
  order by o.attempt_no desc
  limit 1;
$$;

-- F6: failed-code counting and logging for one staff member are serialized, so parallel guesses cannot exceed the limit.
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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('arrival-attempts:' || v_actor::text));
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

-- F11: the arrival log is readable by assigned managers (aal2 via my_venue_ids) and by a TOTP-verified superadmin only.
drop policy arrival_attempts_read on public.arrival_attempts;
create policy arrival_attempts_read on public.arrival_attempts for select to authenticated using (
  venue_id = any ((select app.my_venue_ids(array['MANAGER', 'OWNER']))::uuid[])
  or ((select app.current_aal()) = 'aal2' and (select app.has_platform_role(array['SUPERADMIN'])))
);

grant execute on function app.refunds_to_reconcile(integer) to simply_worker;
revoke execute on all functions in schema app from public;
