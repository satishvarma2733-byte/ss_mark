-- M4.1 cancellation and refund of confirmed bookings (docs/07 s.3-5, s.7; docs/03 C10; docs/08 T09/T10).
-- Refund amounts always come from the booking's accepted policy snapshot and its single BOOKING-allocated capture,
-- evaluated at the database clock inside the booking lock path. CANCELLED is separate from REFUNDED.

alter table public.refunds drop constraint refunds_reason_code_check;
alter table public.refunds add constraint refunds_reason_code_check check (reason_code in (
  'LATE_CAPTURE', 'CANCELLED_HOLD_CAPTURE', 'DUPLICATE_CAPTURE', 'CUSTOMER_CANCEL', 'SERVICE_CANCEL'
));
alter table public.ledger_journals drop constraint ledger_journals_kind_check;
alter table public.ledger_journals add constraint ledger_journals_kind_check check (kind in (
  'CAPTURE_ALLOCATED_BOOKING', 'CAPTURE_REFUND_DUE', 'CAPTURE_QUARANTINED', 'REFUND_PROCESSED', 'CANCELLATION_REFUND_DUE'
));
alter table public.outbox_jobs drop constraint outbox_jobs_kind_check;
alter table public.outbox_jobs add constraint outbox_jobs_kind_check check (kind in (
  'booking.hold_expired', 'booking.confirmed', 'booking.cancelled', 'notification.email', 'privacy.delete_requested',
  'diagnostic.sleep', 'payment.provider_event', 'refund.submit', 'refund.requested'
));

-- Pure: the refund owed if this booking were cancelled at p_now. p_kind CUSTOMER uses the accepted cutoff; SERVICE
-- (venue/platform-caused) always refunds venue_cancel_refund_bps (100%). Cancelling exactly at the cutoff is "at least
-- cutoff minutes before" and gets the early refund.
create or replace function app.cancellation_terms(p_booking public.bookings, p_captured_paise bigint, p_now timestamptz, p_kind text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_policy jsonb := p_booking.policy_snapshot;
  v_cutoff integer := (v_policy ->> 'cancel_cutoff_minutes')::integer;
  v_window text;
  v_bps integer;
  v_change_at timestamptz;
  v_refund bigint;
begin
  if p_kind = 'SERVICE' then
    v_window := 'SERVICE';
    v_bps := coalesce((v_policy ->> 'venue_cancel_refund_bps')::integer, 10000);
    v_change_at := null;
  elsif p_now <= p_booking.start_at - make_interval(mins => v_cutoff) then
    v_window := 'EARLY';
    v_bps := (v_policy ->> 'early_refund_bps')::integer;
    v_change_at := p_booking.start_at - make_interval(mins => v_cutoff);
  else
    v_window := 'LATE';
    v_bps := (v_policy ->> 'late_refund_bps')::integer;
    v_change_at := p_booking.start_at;
  end if;
  v_refund := app.div_half_up(p_captured_paise * v_bps, 10000);
  return jsonb_build_object(
    'window', v_window,
    'refund_bps', v_bps,
    'captured_paise', p_captured_paise,
    'refund_paise', v_refund,
    'retained_paise', p_captured_paise - v_refund,
    'cutoff_minutes', v_cutoff,
    'minutes_before_start', floor(extract(epoch from (p_booking.start_at - p_now)) / 60)::integer,
    'policy_version', (v_policy ->> 'policy_version')::integer,
    'terms_change_at', v_change_at);
end;
$$;

-- The capture this booking was paid with (exactly one, enforced by payment_attempts_one_booking_allocation).
create or replace function app.booking_allocated_attempt(p_booking_id uuid)
returns public.payment_attempts
language plpgsql
stable
set search_path = ''
as $$
declare
  v_attempt public.payment_attempts;
begin
  select * into v_attempt from public.payment_attempts where booking_id = p_booking_id and allocation_state = 'BOOKING';
  if not found then
    perform app.fail('INTERNAL_ERROR', jsonb_build_object('reason', 'confirmed_booking_without_allocation'));
  end if;
  return v_attempt;
end;
$$;

-- Effects of cancelling a CONFIRMED booking. Caller holds the booking lock path and has validated actor, state,
-- version and terms. One transaction: booking, claim, refund liability, journal, events, notifications.
create or replace function app.apply_cancellation(
  p_booking public.bookings, p_attempt public.payment_attempts, p_terms jsonb, p_refund_reason text, p_cancel_reason text,
  p_actor uuid, p_now timestamptz, p_request_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_refund public.refunds;
  v_amount bigint := (p_terms ->> 'refund_paise')::bigint;
begin
  update public.bookings
     set status = 'CANCELLED', cancelled_at = p_now, cancel_reason = p_cancel_reason,
         checkin_token_hash = null, checkin_pin_hash = null
   where id = p_booking.id returning * into v_booking;
  -- The table is free again from now on: a cancelled booking keeps no claim.
  update public.inventory_claims set active = false, released_at = p_now
   where booking_id = p_booking.id and kind = 'BOOKING' and active;

  if v_amount > 0 then
    perform app.post_journal('cancellation:booking:' || p_booking.id, 'CANCELLATION_REFUND_DUE', p_booking.id, p_attempt.id,
      null, 'cancellation:' || (p_terms ->> 'window') || ':' || p_booking.id, jsonb_build_array(
        jsonb_build_object('account', 'CUSTOMER_BOOKING_LIABILITY', 'side', 'DEBIT', 'amount_paise', v_amount),
        jsonb_build_object('account', 'CUSTOMER_REFUND_LIABILITY', 'side', 'CREDIT', 'amount_paise', v_amount)));
    insert into public.refunds (payment_attempt_id, booking_id, amount_paise, currency, reason_code, operation_key, requested_by)
    values (p_attempt.id, p_booking.id, v_amount, 'INR', p_refund_reason, 'refund:booking:' || p_booking.id || ':cancel', p_actor)
    returning * into v_refund;
    perform app.enqueue_job('refund:' || v_refund.id || ':submit', 'refund.submit', jsonb_build_object('refund_id', v_refund.id));
    perform app.enqueue_job('refund:' || v_refund.id || ':requested', 'refund.requested',
                            jsonb_build_object('booking_id', p_booking.id, 'refund_id', v_refund.id));
  end if;

  insert into public.booking_events (booking_id, actor_id, event_type, from_status, to_status, reason_code, request_id,
                                     business_key, safe_metadata)
  values (p_booking.id, p_actor, 'CANCELLED', 'CONFIRMED', 'CANCELLED', p_refund_reason, p_request_id,
          'booking:' || p_booking.id || ':cancelled',
          jsonb_build_object('window', p_terms ->> 'window', 'refund_paise', v_amount,
                             'retained_paise', (p_terms ->> 'retained_paise')::bigint,
                             'policy_version', (p_terms ->> 'policy_version')::integer, 'cancel_reason', p_cancel_reason));
  perform app.enqueue_job('booking:' || p_booking.id || ':cancelled', 'booking.cancelled',
                          jsonb_build_object('booking_id', p_booking.id));

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'public_ref', v_booking.public_ref,
    'status', v_booking.status,
    'cancelled_at', v_booking.cancelled_at,
    'version', v_booking.version,
    'refund_paise', v_amount,
    'retained_paise', (p_terms ->> 'retained_paise')::bigint,
    'refund_id', v_refund.id,
    'refund_status', v_refund.status,
    'window', p_terms ->> 'window');
end;
$$;

-- POST /bookings/{id}/cancel-preview: no mutation. The preview stays valid until the window would change (cutoff or
-- start) or for five minutes, whichever is sooner; the cancel call recomputes at the database clock anyway.
create or replace function app.cancel_preview(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile uuid := app.my_profile_id();
  v_booking public.bookings;
  v_now timestamptz := clock_timestamp();
  v_terms jsonb;
begin
  if v_profile is null then
    perform app.fail('AUTH_REQUIRED');
  end if;
  select * into v_booking from public.bookings where id = p_booking_id and customer_id = v_profile;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  if v_booking.status <> 'CONFIRMED' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_booking.status));
  end if;
  if v_now >= v_booking.start_at then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'started'));
  end if;
  v_terms := app.cancellation_terms(v_booking, (app.booking_allocated_attempt(v_booking.id)).amount_paise, v_now, 'CUSTOMER');
  return v_terms || jsonb_build_object(
    'booking_id', v_booking.id,
    'booking_version', v_booking.version,
    'currency', v_booking.currency,
    'preview_expires_at', least(v_now + interval '5 minutes', (v_terms ->> 'terms_change_at')::timestamptz),
    'server_now', v_now);
end;
$$;

-- POST /bookings/{id}/cancel (customer). Owner only, CONFIRMED and before the start. If the refund at the database
-- clock differs from what the customer saw, nothing changes and 409 CANCELLATION_CHANGED returns the new terms.
create or replace function app.cancel_booking(
  p_booking_id uuid, p_reason_code text, p_expected_version integer, p_expected_refund_paise bigint, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_booking public.bookings;
  v_attempt public.payment_attempts;
  v_now timestamptz;
  v_terms jsonb;
begin
  if p_reason_code is not null and p_reason_code not in ('CHANGE_OF_PLANS', 'FOUND_ALTERNATIVE', 'VENUE_ISSUE', 'OTHER') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason_code'));
  end if;
  if not exists (select 1 from public.bookings where id = p_booking_id and customer_id = v_actor) then
    perform app.fail('NOT_FOUND');
  end if;
  v_now := app.lock_booking(p_booking_id);
  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking.status <> 'CONFIRMED' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_booking.status));
  end if;
  if v_now >= v_booking.start_at then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'started'));
  end if;
  if v_booking.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_booking.version, 'status', v_booking.status));
  end if;
  select * into v_attempt from public.payment_attempts where id = (app.booking_allocated_attempt(v_booking.id)).id for update;
  v_terms := app.cancellation_terms(v_booking, v_attempt.amount_paise, v_now, 'CUSTOMER');
  if (v_terms ->> 'refund_paise')::bigint is distinct from p_expected_refund_paise then
    perform app.fail('CANCELLATION_CHANGED', v_terms || jsonb_build_object('booking_version', v_booking.version));
  end if;
  -- cancel_reason is namespaced (CUSTOMER:/SERVICE:) because both reason lists contain OTHER.
  return app.apply_cancellation(v_booking, v_attempt, v_terms, 'CUSTOMER_CANCEL',
                                'CUSTOMER:' || coalesce(p_reason_code, 'UNSPECIFIED'), v_actor, v_now, p_request_id);
end;
$$;

-- POST /bookings/{id}/service-cancel: venue- or platform-caused cancellation with a full refund (docs/07 s.4). Assigned
-- manager/owner or platform support/superadmin, TOTP-verified, with a reason; audited. Not for checked-in bookings
-- (an on-site incident is a support remedy).
create or replace function app.service_cancel_booking(
  p_booking_id uuid, p_reason_code text, p_reason text, p_expected_version integer, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_venue uuid;
  v_role text;
  v_booking public.bookings;
  v_attempt public.payment_attempts;
  v_now timestamptz;
  v_terms jsonb;
  v_result jsonb;
begin
  select venue_id into v_venue from public.bookings where id = p_booking_id;
  if v_venue is null then
    perform app.fail('NOT_FOUND');
  end if;
  if app.is_venue_member(v_venue, array['MANAGER', 'OWNER']) then
    v_role := 'VENUE_MANAGER';
  elsif app.has_platform_role(array['SUPPORT', 'SUPERADMIN']) then
    v_role := 'PLATFORM_ADMIN';
  elsif app.is_venue_member(v_venue, array['STAFF']) then
    perform app.fail('FORBIDDEN');
  else
    perform app.fail('NOT_FOUND');
  end if;
  perform app.require_aal2();
  if p_reason_code is null or p_reason_code not in ('VENUE_UNAVAILABLE', 'VENUE_CLOSED', 'TABLE_UNAVAILABLE', 'SAFETY', 'OTHER') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason_code'));
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 3 and 500 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason'));
  end if;

  v_now := app.lock_booking(p_booking_id);
  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking.status <> 'CONFIRMED' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_booking.status));
  end if;
  if v_now >= v_booking.end_at then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'ended'));
  end if;
  if v_booking.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_booking.version, 'status', v_booking.status));
  end if;
  select * into v_attempt from public.payment_attempts where id = (app.booking_allocated_attempt(v_booking.id)).id for update;
  v_terms := app.cancellation_terms(v_booking, v_attempt.amount_paise, v_now, 'SERVICE');
  v_result := app.apply_cancellation(v_booking, v_attempt, v_terms, 'SERVICE_CANCEL', 'SERVICE:' || p_reason_code, v_actor,
                                     v_now, p_request_id);
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, venue_id, request_id, reason, safe_diff)
  values (v_actor, v_role, 'booking.service_cancel', 'booking', v_booking.id, v_venue, p_request_id, trim(p_reason),
          jsonb_build_object('reason_code', p_reason_code, 'refund_paise', v_terms ->> 'refund_paise'));
  return v_result;
end;
$$;

-- Customer projection now carries why a booking was cancelled: CUSTOMER:<code|UNSPECIFIED>, SERVICE:<code>, or
-- CUSTOMER_ABANDONED for a released hold.
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
    'server_now', clock_timestamp());
$$;

grant execute on function
  app.cancel_preview(uuid),
  app.cancel_booking(uuid, text, integer, bigint, uuid),
  app.service_cancel_booking(uuid, text, text, integer, uuid)
  to authenticated;
-- app.cancellation_terms, app.booking_allocated_attempt and app.apply_cancellation are internal (no grants).
revoke execute on all functions in schema app from public;
