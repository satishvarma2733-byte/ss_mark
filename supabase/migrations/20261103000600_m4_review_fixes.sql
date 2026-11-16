-- M4 review fixes (review of the M4 migrations, 3 Nov 2026). Each change is described where it applies.


-- F1: refunds that follow the policy are capped by the booking's remaining customer liability (an admin refund taken
-- from the booking before it finished has already paid part of it back).

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
  -- What this capture still holds for the booking (never more than the capture itself).
  v_remaining bigint := least(p_captured_paise, greatest(app.booking_liability_balance(p_booking.id), 0));
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
  v_refund := least(app.div_half_up(p_captured_paise * v_bps, 10000), v_remaining);
  return jsonb_build_object(
    'window', v_window,
    'refund_bps', v_bps,
    'captured_paise', p_captured_paise,
    'refund_paise', v_refund,
    'retained_paise', v_remaining - v_refund,
    'cutoff_minutes', v_cutoff,
    'minutes_before_start', floor(extract(epoch from (p_booking.start_at - p_now)) / 60)::integer,
    'policy_version', (v_policy ->> 'policy_version')::integer,
    'terms_change_at', v_change_at);
end;
$$;

create or replace function app.staff_mark_no_show(p_booking_id uuid, p_expected_version integer, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_booking public.bookings;
  v_now timestamptz;
  v_attempt public.payment_attempts;
  v_refund public.refunds;
  v_amount bigint := 0;
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  v_actor := app.require_venue_staff(v_booking.venue_id);
  v_now := app.lock_booking(p_booking_id);
  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking.status <> 'CONFIRMED' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_booking.status));
  end if;
  if v_now < v_booking.start_at + make_interval(mins => (v_booking.policy_snapshot ->> 'grace_minutes')::integer) then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'grace_not_elapsed'));
  end if;
  if v_booking.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_booking.version, 'status', v_booking.status));
  end if;
  update public.bookings set status = 'NO_SHOW', checkin_token_hash = null, checkin_pin_hash = null
  where id = p_booking_id returning * into v_booking;
  select * into v_attempt from public.payment_attempts where id = (app.booking_allocated_attempt(p_booking_id)).id for update;
  v_amount := least(app.div_half_up(v_attempt.amount_paise * coalesce((v_booking.policy_snapshot ->> 'no_show_refund_bps')::integer, 0), 10000),
                   greatest(app.booking_liability_balance(p_booking_id), 0));
  if v_amount > 0 then
    perform app.post_journal('no_show:booking:' || p_booking_id, 'NO_SHOW_REFUND_DUE', p_booking_id, v_attempt.id, null,
      'no_show:' || p_booking_id, jsonb_build_array(
        jsonb_build_object('account', 'CUSTOMER_BOOKING_LIABILITY', 'side', 'DEBIT', 'amount_paise', v_amount),
        jsonb_build_object('account', 'CUSTOMER_REFUND_LIABILITY', 'side', 'CREDIT', 'amount_paise', v_amount)));
    insert into public.refunds (payment_attempt_id, booking_id, amount_paise, currency, reason_code, operation_key, requested_by)
    values (v_attempt.id, p_booking_id, v_amount, 'INR', 'NO_SHOW', 'refund:booking:' || p_booking_id || ':no_show', v_actor)
    returning * into v_refund;
    perform app.enqueue_job('refund:' || v_refund.id || ':submit', 'refund.submit', jsonb_build_object('refund_id', v_refund.id));
  end if;
  insert into public.booking_events (booking_id, actor_id, event_type, from_status, to_status, request_id, business_key, safe_metadata)
  values (p_booking_id, v_actor, 'NO_SHOW', 'CONFIRMED', 'NO_SHOW', p_request_id, 'booking:' || p_booking_id || ':no_show',
          jsonb_build_object('refund_paise', v_amount));
  perform app.enqueue_job('booking:' || p_booking_id || ':no_show', 'booking.no_show', jsonb_build_object('booking_id', p_booking_id));
  perform app.audit(v_actor, case when app.is_venue_member(v_booking.venue_id, array['MANAGER', 'OWNER']) then 'VENUE_MANAGER'
                                  else 'VENUE_STAFF' end,
                    'booking.no_show', 'booking', p_booking_id, v_booking.venue_id, p_request_id, null,
                    jsonb_build_object('refund_paise', v_amount));
  return jsonb_build_object('booking_id', p_booking_id, 'status', v_booking.status, 'version', v_booking.version,
                            'refund_paise', v_amount);
end;
$$;


-- F5: while a venue is in review, its draft terms cannot change (or be created): the reviewer approves exactly what
-- was submitted. Status changes made by the review itself are allowed.
create or replace function app.guard_policy_in_review()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'DRAFT'
     and exists (select 1 from public.venues v where v.id = new.venue_id and v.status = 'PENDING_REVIEW')
     and (tg_op = 'INSERT' or (
       (new.byo_food, new.byo_details, new.outside_delivery, new.handover_instructions, new.house_rules, new.cancel_cutoff_minutes,
        new.early_refund_bps, new.late_refund_bps, new.no_show_refund_bps, new.minimum_minutes, new.increment_minutes,
        new.maximum_minutes, new.buffer_minutes, new.grace_minutes, new.lead_minutes, new.max_horizon_days, new.end_reminder_minutes)
       is distinct from
       (old.byo_food, old.byo_details, old.outside_delivery, old.handover_instructions, old.house_rules, old.cancel_cutoff_minutes,
        old.early_refund_bps, old.late_refund_bps, old.no_show_refund_bps, old.minimum_minutes, old.increment_minutes,
        old.maximum_minutes, old.buffer_minutes, old.grace_minutes, old.lead_minutes, old.max_horizon_days, old.end_reminder_minutes))) then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'venue_in_review'));
  end if;
  return new;
end;
$$;
create trigger venue_policies_in_review before insert or update on public.venue_policies
  for each row execute function app.guard_policy_in_review();

create or replace function app.partner_revoke_invitation(p_invitation_id uuid, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.venue_invitations;
  v_actor uuid;
begin
  select * into v_invitation from public.venue_invitations where id = p_invitation_id;
  v_actor := app.require_venue_manager(v_invitation.venue_id);
  if v_invitation.role = 'MANAGER' and not app.is_venue_member(v_invitation.venue_id, array['OWNER']) then
    perform app.fail('FORBIDDEN', jsonb_build_object('reason', 'owner_only'));
  end if;
  update public.venue_invitations set status = 'REVOKED' where id = p_invitation_id and status = 'INVITED' returning * into v_invitation;
  if not found then
    perform app.fail('INVALID_TRANSITION');
  end if;
  perform app.audit(v_actor, app.manager_role(v_invitation.venue_id), 'invitation.revoke', 'venue_invitation', p_invitation_id,
                    v_invitation.venue_id, p_request_id, null);
  return jsonb_build_object('invitation_id', p_invitation_id, 'status', 'REVOKED');
end;
$$;

create or replace function app.accept_invitation(p_invitation_id uuid, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_invitation public.venue_invitations;
  v_existing public.venue_memberships;
  v_role text;
begin
  select * into v_invitation from public.venue_invitations
  where id = p_invitation_id and email = app.my_auth_email() for update;
  if not found or v_invitation.status in ('REVOKED') then
    perform app.fail('NOT_FOUND');
  end if;
  if v_invitation.status = 'ACCEPTED' and v_invitation.accepted_by = v_actor then
    return jsonb_build_object('venue_id', v_invitation.venue_id, 'status', 'ACCEPTED', 'replayed', true);
  end if;
  if v_invitation.status <> 'INVITED' or v_invitation.expires_at <= now() then
    perform app.fail('INVITATION_EXPIRED');
  end if;
  select * into v_existing from public.venue_memberships where venue_id = v_invitation.venue_id and user_id = v_actor for update;
  -- Never downgrade an existing active role by accepting a lower invitation.
  v_role := case
    when v_existing.status = 'ACTIVE' and v_existing.role = 'OWNER' then 'OWNER'
    when v_existing.status = 'ACTIVE' and v_existing.role = 'MANAGER' then 'MANAGER'
    else v_invitation.role end;
  insert into public.venue_memberships (venue_id, user_id, role, status, invited_by, accepted_at)
  values (v_invitation.venue_id, v_actor, v_role, 'ACTIVE', v_invitation.invited_by, now())
  on conflict (venue_id, user_id) do update set role = excluded.role, status = 'ACTIVE', accepted_at = now();
  update public.venue_invitations set status = 'ACCEPTED', accepted_by = v_actor, accepted_at = now() where id = p_invitation_id;
  perform app.audit(v_actor, 'INVITEE', 'invitation.accept', 'venue_invitation', p_invitation_id, v_invitation.venue_id,
                    p_request_id, null, jsonb_build_object('role', v_role));
  return jsonb_build_object('venue_id', v_invitation.venue_id, 'role', v_role, 'status', 'ACCEPTED', 'replayed', false);
end;
$$;

create or replace function app.partner_invite(p_venue_id uuid, p_email text, p_role text, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_venue_manager(p_venue_id);
  v_email text := lower(trim(p_email));
  v_invitation public.venue_invitations;
begin
  if p_role not in ('STAFF', 'MANAGER') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'role'));
  end if;
  if p_role = 'MANAGER' and not app.is_venue_member(p_venue_id, array['OWNER']) then
    perform app.fail('FORBIDDEN', jsonb_build_object('reason', 'owner_only'));
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'email'));
  end if;
  perform 1 from public.venues where id = p_venue_id for update;
  if exists (
    select 1 from public.venue_memberships m join public.profiles p on p.id = m.user_id join auth.users u on u.id = p.auth_user_id
    where m.venue_id = p_venue_id and m.status = 'ACTIVE' and lower(u.email) = v_email
  ) then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'already_member'));
  end if;
  update public.venue_invitations set status = 'EXPIRED'
  where venue_id = p_venue_id and status = 'INVITED' and expires_at <= now();
  select * into v_invitation from public.venue_invitations where venue_id = p_venue_id and email = v_email and status = 'INVITED';
  if found then
    return jsonb_build_object('invitation_id', v_invitation.id, 'status', v_invitation.status, 'role', v_invitation.role,
                              'expires_at', v_invitation.expires_at, 'existing', true);
  end if;
  if (select count(*) from public.venue_invitations where venue_id = p_venue_id and status = 'INVITED') >= 50 then
    perform app.fail('RATE_LIMITED', jsonb_build_object('reason', 'too_many_open_invitations'));
  end if;
  insert into public.venue_invitations (venue_id, email, role, invited_by, expires_at)
  values (p_venue_id, v_email, p_role, v_actor, now() + interval '7 days') returning * into v_invitation;
  perform app.enqueue_job('invitation:' || v_invitation.id || ':created', 'invitation.created',
                          jsonb_build_object('invitation_id', v_invitation.id));
  perform app.audit(v_actor, app.manager_role(p_venue_id), 'invitation.create', 'venue_invitation', v_invitation.id, p_venue_id,
                    p_request_id, null, jsonb_build_object('role', p_role));
  return jsonb_build_object('invitation_id', v_invitation.id, 'status', v_invitation.status, 'role', v_invitation.role,
                            'expires_at', v_invitation.expires_at, 'existing', false);
end;
$$;


-- F2: a FAILED refund is still owed (its liability stays posted). Finance retries it as a new provider operation linked
-- by retry_of, with no new journal and no new charge to the partner or platform. Until retried, a FAILED refund still
-- counts against what admin refunds may add, so it can never be paid (or charged) twice.
alter table public.refunds add column retry_of uuid references public.refunds (id);
create unique index refunds_one_retry on public.refunds (retry_of) where retry_of is not null;
alter table public.refunds drop constraint refunds_admin_fields;
alter table public.refunds add constraint refunds_admin_fields check (
  (reason_code = 'ADMIN_REFUND' and retry_of is null) = (charge_to is not null and admin_reason is not null and requested_by is not null));
comment on column public.refunds.retry_of is 'The FAILED refund this one retries. Retries carry no journal and no charge_to.';

create or replace function app.guard_refund_admin_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.reason_code, new.charge_to, new.admin_reason, new.requested_by, new.retry_of)
     is distinct from (old.reason_code, old.charge_to, old.admin_reason, old.requested_by, old.retry_of) then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'refunds', 'reason', 'admin_fields'));
  end if;
  return new;
end;
$$;

-- Money a payment attempt has committed to refunds: everything except FAILED refunds that a retry has taken over.
create or replace function app.refund_reserved(p_attempt_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(f.amount_paise), 0)::bigint from public.refunds f
  where f.payment_attempt_id = p_attempt_id
    and not (f.status = 'FAILED' and exists (select 1 from public.refunds r where r.retry_of = f.id));
$$;

create or replace function app.refundable_attempts(p_booking_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_attempt_id', a.id, 'allocation', a.allocation_state, 'captured_paise', a.amount_paise,
           'reserved_paise', r.reserved, 'refundable_paise', a.amount_paise - r.reserved)
         order by a.created_at), '[]'::jsonb)
  from public.payment_attempts a
  cross join lateral (select app.refund_reserved(a.id) as reserved) r
  where a.booking_id = p_booking_id and a.state = 'CAPTURED' and a.allocation_state in ('BOOKING', 'EXTENSION');
$$;

create or replace function app.admin_refund(
  p_booking_id uuid, p_amount_paise bigint, p_charge_to text, p_reason text, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_finance();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_now timestamptz;
  v_booking public.bookings;
  v_earning public.booking_earnings;
  v_charge text;
  v_attempt public.payment_attempts;
  v_refundable bigint;
  v_liability bigint;
  v_partner uuid;
  v_refund public.refunds;
begin
  if p_amount_paise is null or p_amount_paise <= 0 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'amount_paise'));
  end if;
  if char_length(v_reason) not between 10 and 500 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason'));
  end if;
  if p_charge_to is not null and p_charge_to not in ('PARTNER', 'PLATFORM') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'charge_to'));
  end if;
  v_now := app.lock_booking(p_booking_id);
  -- F6: a replayed request returns the refund it already created.
  if p_request_id is not null then
    select * into v_refund from public.refunds where operation_key = 'refund:admin:' || p_request_id;
    if found then
      return jsonb_build_object('refund_id', v_refund.id, 'booking_id', v_refund.booking_id, 'status', v_refund.status,
                                'amount_paise', v_refund.amount_paise, 'charge_to', v_refund.charge_to, 'replayed', true);
    end if;
  end if;
  select * into v_booking from public.bookings where id = p_booking_id;
  if not exists (select 1 from public.payment_attempts where booking_id = p_booking_id and allocation_state = 'BOOKING') then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'booking_not_paid', 'status', v_booking.status));
  end if;
  -- A finished booking is recognised first, so the refund is charged against the right account.
  v_earning := app.recognize_booking_earning(v_booking, v_now);
  if v_earning.id is null then
    v_charge := 'BOOKING';
    v_liability := app.booking_liability_balance(p_booking_id);
    if p_amount_paise > v_liability then
      perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'amount_paise', 'reason', 'exceeds_refundable',
                                                               'max_paise', greatest(v_liability, 0)));
    end if;
  else
    if p_charge_to is null then
      perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'charge_to', 'reason', 'required_after_earning'));
    end if;
    v_charge := p_charge_to;
  end if;

  select a.* into v_attempt from public.payment_attempts a
   where a.booking_id = p_booking_id and a.state = 'CAPTURED' and a.allocation_state in ('BOOKING', 'EXTENSION')
   order by a.amount_paise - app.refund_reserved(a.id) desc, a.created_at
   limit 1
   for update;
  v_refundable := v_attempt.amount_paise - app.refund_reserved(v_attempt.id);
  if p_amount_paise > v_refundable then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'amount_paise', 'reason', 'exceeds_refundable',
                                                             'max_paise', v_refundable));
  end if;
  if v_charge = 'PARTNER' then
    select partner_id into v_partner from public.venues where id = v_booking.venue_id;
    perform app.lock_partner_payable(v_partner);
  end if;

  insert into public.refunds (payment_attempt_id, booking_id, amount_paise, currency, reason_code, operation_key, requested_by,
                              approved_by, charge_to, admin_reason)
  values (v_attempt.id, p_booking_id, p_amount_paise, 'INR', 'ADMIN_REFUND',
          'refund:admin:' || coalesce(p_request_id, gen_random_uuid()), v_actor, null, v_charge, v_reason)
  returning * into v_refund;
  perform app.post_journal('admin_refund:' || v_refund.id, 'ADMIN_REFUND_DUE', p_booking_id, v_attempt.id, v_refund.id,
    'admin_refund:' || v_refund.id, jsonb_build_array(
      case v_charge
        when 'BOOKING' then jsonb_build_object('account', 'CUSTOMER_BOOKING_LIABILITY', 'side', 'DEBIT', 'amount_paise', p_amount_paise)
        when 'PARTNER' then jsonb_build_object('account', 'PARTNER_PAYABLE', 'partner_id', v_partner, 'side', 'DEBIT',
                                               'amount_paise', p_amount_paise)
        else jsonb_build_object('account', 'PLATFORM_ADJUSTMENT_EXPENSE', 'side', 'DEBIT', 'amount_paise', p_amount_paise) end,
      jsonb_build_object('account', 'CUSTOMER_REFUND_LIABILITY', 'side', 'CREDIT', 'amount_paise', p_amount_paise)));
  perform app.enqueue_job('refund:' || v_refund.id || ':submit', 'refund.submit', jsonb_build_object('refund_id', v_refund.id));
  perform app.enqueue_job('refund:' || v_refund.id || ':requested', 'refund.requested',
                          jsonb_build_object('booking_id', p_booking_id, 'refund_id', v_refund.id));
  insert into public.booking_events (booking_id, actor_id, event_type, reason_code, request_id, business_key, safe_metadata)
  values (p_booking_id, v_actor, 'ADMIN_REFUND', 'ADMIN_REFUND', p_request_id, 'refund:' || v_refund.id || ':admin',
          jsonb_build_object('refund_id', v_refund.id, 'amount_paise', p_amount_paise, 'charge_to', v_charge));
  perform app.audit(v_actor, app.finance_role(), 'refund.admin_requested', 'refund', v_refund.id, v_booking.venue_id,
                    p_request_id, v_reason,
                    jsonb_build_object('booking_id', p_booking_id, 'amount_paise', p_amount_paise, 'charge_to', v_charge));
  return jsonb_build_object('refund_id', v_refund.id, 'booking_id', p_booking_id, 'status', v_refund.status,
                            'amount_paise', p_amount_paise, 'charge_to', v_charge);
end;
$$;


create or replace function app.admin_retry_refund(p_refund_id uuid, p_reason text, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_finance();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_booking_id uuid;
  v_failed public.refunds;
  v_retry public.refunds;
begin
  if char_length(v_reason) not between 10 and 500 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason'));
  end if;
  select booking_id into v_booking_id from public.refunds where id = p_refund_id;
  if v_booking_id is null then
    perform app.fail('NOT_FOUND');
  end if;
  perform app.lock_booking(v_booking_id);
  select * into v_failed from public.refunds where id = p_refund_id for update;
  if v_failed.status <> 'FAILED' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_failed.status));
  end if;
  select * into v_retry from public.refunds where retry_of = p_refund_id;
  if found then
    return jsonb_build_object('refund_id', v_retry.id, 'retry_of', p_refund_id, 'status', v_retry.status,
                              'amount_paise', v_retry.amount_paise, 'replayed', true);
  end if;
  insert into public.refunds (payment_attempt_id, booking_id, amount_paise, currency, reason_code, operation_key, requested_by, retry_of)
  values (v_failed.payment_attempt_id, v_failed.booking_id, v_failed.amount_paise, v_failed.currency, v_failed.reason_code,
          'refund:retry:' || v_failed.id, v_actor, v_failed.id)
  returning * into v_retry;
  perform app.enqueue_job('refund:' || v_retry.id || ':submit', 'refund.submit', jsonb_build_object('refund_id', v_retry.id));
  insert into public.booking_events (booking_id, actor_id, event_type, reason_code, request_id, business_key, safe_metadata)
  values (v_failed.booking_id, v_actor, 'REFUND_RETRIED', v_failed.reason_code, p_request_id, 'refund:' || v_retry.id || ':retry',
          jsonb_build_object('refund_id', v_retry.id, 'retry_of', v_failed.id, 'amount_paise', v_retry.amount_paise));
  perform app.audit(v_actor, app.finance_role(), 'refund.retried', 'refund', v_retry.id,
                    (select venue_id from public.bookings where id = v_failed.booking_id), p_request_id, v_reason,
                    jsonb_build_object('retry_of', v_failed.id, 'amount_paise', v_retry.amount_paise));
  return jsonb_build_object('refund_id', v_retry.id, 'retry_of', p_refund_id, 'status', v_retry.status,
                            'amount_paise', v_retry.amount_paise, 'replayed', false);
end;
$$;

create or replace function app.admin_refund_options(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_earning public.booking_earnings;
  v_attempts jsonb;
  v_max bigint;
  v_liability bigint;
  v_earnable boolean;
begin
  perform app.require_finance();
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  select * into v_earning from public.booking_earnings where booking_id = p_booking_id;
  v_attempts := app.refundable_attempts(p_booking_id);
  select coalesce(max((x ->> 'refundable_paise')::bigint), 0) into v_max from jsonb_array_elements(v_attempts) x;
  v_liability := app.booking_liability_balance(p_booking_id);
  v_earnable := v_earning.id is not null or app.booking_earnable(v_booking, clock_timestamp());
  return jsonb_build_object(
    'booking_id', v_booking.id,
    'status', v_booking.status,
    'attempts', v_attempts,
    'booking_liability_paise', v_liability,
    'earned', case when v_earning.id is null then null else jsonb_build_object(
      'gross_paise', v_earning.gross_paise, 'platform_fee_paise', v_earning.platform_fee_paise,
      'partner_paise', v_earning.partner_paise, 'earned_at', v_earning.earned_at) end,
    -- Finished bookings are charged to the partner or the platform; earlier refunds come out of the booking itself.
    'needs_charge_to', v_earnable,
    'retryable', coalesce((select jsonb_agg(jsonb_build_object('refund_id', f.id, 'amount_paise', f.amount_paise,
                                                               'reason_code', f.reason_code, 'last_error_code', f.last_error_code,
                                                               'created_at', f.created_at) order by f.created_at)
                           from public.refunds f
                           where f.booking_id = p_booking_id and f.status = 'FAILED'
                             and not exists (select 1 from public.refunds r where r.retry_of = f.id)), '[]'::jsonb),
    'max_refund_paise', case when v_earnable then v_max else least(v_max, greatest(v_liability, 0)) end);
end;
$$;

create or replace function app.admin_finance_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_finance();
  v_now timestamptz := clock_timestamp();
begin
  return jsonb_build_object(
    'actor_id', v_actor,
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object('code', a.code, 'account_type', a.account_type, 'balance_paise', bal.amount)
                       order by a.code)
      from public.ledger_accounts a
      cross join lateral (
        select coalesce(sum(case when (e.side = 'DEBIT') = (a.account_type in ('ASSET', 'EXPENSE'))
                                 then e.amount_paise else -e.amount_paise end), 0)::bigint as amount
        from public.ledger_entries e where e.account_id = a.id) bal
      where a.partner_id is null), '[]'::jsonb),
    'partner_payable_total_paise', (
      select coalesce(sum(case when e.side = 'CREDIT' then e.amount_paise else -e.amount_paise end), 0)::bigint
      from public.ledger_accounts a join public.ledger_entries e on e.account_id = a.id
      where a.partner_id is not null and a.code = 'PARTNER_PAYABLE'),
    'refunds', jsonb_build_object(
      'by_status', coalesce((select jsonb_object_agg(s.status, jsonb_build_object('count', s.n, 'amount_paise', s.amount))
                             from (select status, count(*) as n, sum(amount_paise)::bigint as amount
                                   from public.refunds group by status) s), '{}'::jsonb),
      'attention', coalesce((
        select jsonb_agg(jsonb_build_object('refund_id', f.id, 'booking_id', f.booking_id, 'public_ref', b.public_ref,
                                            'amount_paise', f.amount_paise, 'reason_code', f.reason_code, 'status', f.status,
                                            'charge_to', f.charge_to, 'last_error_code', f.last_error_code,
                                            'created_at', f.created_at)
                         order by f.created_at)
        from (select * from public.refunds
              where (status = 'UNKNOWN'
                     or (status = 'FAILED' and not exists (select 1 from public.refunds r where r.retry_of = refunds.id)))
                 or (status in ('REQUESTED', 'PROCESSING') and created_at < v_now - interval '15 minutes')
              order by created_at limit 25) f
        join public.bookings b on b.id = f.booking_id), '[]'::jsonb)),
    'reconciliation', coalesce((select jsonb_agg(app.reconciliation_run_json(r) order by r.started_at desc)
                                from (select * from public.reconciliation_runs order by started_at desc limit 10) r), '[]'::jsonb),
    'partners', coalesce((
      select jsonb_agg(item order by (item ->> 'payable_paise')::bigint desc, item ->> 'partner_name')
      from (
        select jsonb_build_object(
          'partner_id', p.id, 'partner_name', p.display_name, 'payout_enabled', p.payout_enabled, 'is_synthetic', p.is_synthetic,
          'payable_paise', app.partner_payable_balance(p.id),
          'unallocated_earnings_paise', (select coalesce(sum(e.partner_paise), 0)::bigint from public.booking_earnings e
                                          where e.partner_id = p.id
                                            and not exists (select 1 from public.payout_allocations x
                                                            where x.booking_earning_id = e.id and x.active)),
          'unallocated_adjustments_paise', (select coalesce(sum(f.amount_paise), 0)::bigint from public.refunds f
                                             join public.bookings b on b.id = f.booking_id
                                             join public.venues v on v.id = b.venue_id
                                             where v.partner_id = p.id and f.charge_to = 'PARTNER'
                                               and not exists (select 1 from public.payout_allocations x
                                                               where x.refund_id = f.id and x.active)),
          'open_batch_id', (select pb.id from public.payout_batches pb
                             where pb.partner_id = p.id and pb.status in ('DRAFT', 'APPROVED', 'PROCESSING'))) as item
        from public.partners p
        where exists (select 1 from public.ledger_accounts a where a.partner_id = p.id)
        order by p.created_at desc
        limit 50) t), '[]'::jsonb),
    'payout_batches', coalesce((select jsonb_agg(app.payout_batch_json(pb, v_actor) order by pb.created_at desc)
                                from (select * from public.payout_batches order by created_at desc limit 25) pb), '[]'::jsonb),
    'fee_configs', coalesce((select jsonb_agg(app.fee_config_json(f, v_actor) order by f.effective_from desc, f.created_at desc)
                             from (select * from public.fee_configurations order by effective_from desc, created_at desc
                                   limit 20) f), '[]'::jsonb),
    'server_now', v_now);
end;
$$;

create or replace function app.approve_payout_batch(p_batch_id uuid, p_expected_version integer, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_finance();
  v_batch public.payout_batches;
  v_run public.reconciliation_runs;
  v_available bigint;
  v_uncovered integer;
  v_first timestamptz;
  v_blocking uuid;
begin
  select * into v_batch from public.payout_batches where id = p_batch_id;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  perform app.lock_partner_payable(v_batch.partner_id);
  select * into v_batch from public.payout_batches where id = p_batch_id for update;
  if v_batch.status <> 'DRAFT' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_batch.status));
  end if;
  if v_batch.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_batch.version));
  end if;
  if v_batch.created_by = v_actor then
    perform app.fail('SEPARATION_OF_DUTIES');
  end if;
  -- Every capture behind the batch, and every processed refund of its bookings or adjustments, must sit inside a
  -- MATCHED run of its own provider and environment with no newer MISMATCH run over the same instant.
  create temporary table payout_points on commit drop as
  select a.captured_at as at, a.provider, a.environment
  from public.payout_allocations x
  join public.payment_attempts a on a.booking_id = x.booking_id and a.state = 'CAPTURED'
                                and a.allocation_state in ('BOOKING', 'EXTENSION')
  where x.batch_id = p_batch_id
  union
  select f.processed_at, a.provider, a.environment
  from public.payout_allocations x
  join public.refunds f on f.booking_id = x.booking_id and f.status = 'PROCESSED'
  join public.payment_attempts a on a.id = f.payment_attempt_id
  where x.batch_id = p_batch_id;
  select count(*), min(p.at) into v_uncovered, v_first
  from pg_temp.payout_points p
  where not exists (
    select 1 from public.reconciliation_runs r
    where r.status = 'MATCHED' and r.provider = p.provider and r.environment = p.environment
      and r.period_from <= p.at and r.period_to > p.at
      and not exists (select 1 from public.reconciliation_runs m
                      where m.status = 'MISMATCH' and m.provider = p.provider and m.environment = p.environment
                        and m.period_from <= p.at and m.period_to > p.at and m.completed_at > r.completed_at));
  if v_uncovered > 0 then
    select m.id into v_blocking from public.reconciliation_runs m
     where m.status = 'MISMATCH' and m.period_from <= v_first and m.period_to > v_first
     order by m.completed_at desc limit 1;
    drop table pg_temp.payout_points;
    perform app.fail('RECONCILIATION_REQUIRED', jsonb_build_object(
      'uncovered', v_uncovered, 'first_uncovered_at', v_first, 'mismatch_run_id', v_blocking));
  end if;
  -- The newest matched run covering the batch is recorded on it.
  select r.* into v_run from public.reconciliation_runs r
   where r.status = 'MATCHED' and exists (select 1 from pg_temp.payout_points p
                                         where r.provider = p.provider and r.environment = p.environment
                                           and r.period_from <= p.at and r.period_to > p.at)
   order by r.completed_at desc limit 1;
  drop table pg_temp.payout_points;
  -- Available payable re-checked under the partner lock: refunds charged since the draft may have reduced it.
  v_available := app.partner_payable_balance(v_batch.partner_id);
  if v_batch.amount_paise > v_available then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'payable_changed', 'available_paise', v_available));
  end if;
  update public.payout_batches set status = 'APPROVED', approved_by = v_actor, approved_at = clock_timestamp(),
                                   reconciliation_run_id = v_run.id
   where id = p_batch_id returning * into v_batch;
  perform app.audit(v_actor, app.finance_role(), 'payout.approved', 'payout_batch', v_batch.id, null, p_request_id, null,
                    jsonb_build_object('amount_paise', v_batch.amount_paise, 'reconciliation_run_id', v_run.id));
  return app.payout_batch_json(v_batch, v_actor);
end;
$$;

create or replace function app.admin_business_metrics(p_from date, p_to date, p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_platform_admin(array['SUPPORT', 'FINANCE', 'SUPERADMIN']);
  v_finance boolean := app.has_platform_role(array['FINANCE', 'SUPERADMIN']);
  v_start timestamptz;
  v_end timestamptz;
  v_funnel jsonb;
  v_outcomes jsonb;
  v_occupancy jsonb;
  v_repeat jsonb;
  v_reliability jsonb;
  v_finance_block jsonb;
  v_run public.reconciliation_runs;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'period'));
  end if;
  if p_venue_id is not null and not exists (select 1 from public.venues where id = p_venue_id) then
    perform app.fail('NOT_FOUND');
  end if;
  v_start := p_from::timestamp at time zone 'Asia/Kolkata';
  v_end := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';

  -- Funnel: every booking starts as a hold; created in the period.
  select jsonb_build_object(
           'holds', count(*),
           'paid', count(*) filter (where b.confirmed_at is not null),
           'expired_unpaid', count(*) filter (where b.status = 'EXPIRED'),
           'abandoned', count(*) filter (where b.status = 'CANCELLED' and b.confirmed_at is null))
    into v_funnel
  from public.bookings b
  where b.created_at >= v_start and b.created_at < v_end and (p_venue_id is null or b.venue_id = p_venue_id);

  -- Outcomes of paid bookings that started in the period.
  select jsonb_build_object(
           'paid_bookings', count(*),
           'completed', count(*) filter (where b.status = 'COMPLETED'),
           'no_show', count(*) filter (where b.status = 'NO_SHOW'),
           'customer_cancelled', count(*) filter (where b.status = 'CANCELLED' and b.cancel_reason like 'CUSTOMER:%'),
           'service_cancelled', count(*) filter (where b.status = 'CANCELLED' and b.cancel_reason like 'SERVICE:%'),
           'in_progress', count(*) filter (where b.status in ('CONFIRMED', 'CHECKED_IN')))
    into v_outcomes
  from public.bookings b
  where b.confirmed_at is not null and b.start_at >= v_start and b.start_at < v_end
    and (p_venue_id is null or b.venue_id = p_venue_id);

  -- Occupancy: paid table-minutes (not cancelled) over bookable table-minutes from each venue's current opening hours.
  select jsonb_build_object(
           'booked_minutes', (select coalesce(sum(extract(epoch from (b.end_at - b.start_at)) / 60), 0)::bigint
                              from public.bookings b
                              where b.confirmed_at is not null and b.status in ('CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW')
                                and b.start_at >= v_start and b.start_at < v_end
                                and (p_venue_id is null or b.venue_id = p_venue_id)),
           'open_minutes', (select coalesce(sum(extract(epoch from (op.closes_local - op.opens_local)) / 60
                                                + case when op.closes_next_day then 1440 else 0 end), 0)::bigint
                            from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d (day)
                            join public.venues v on v.status = 'PUBLISHED' and (p_venue_id is null or v.id = p_venue_id)
                            join public.opening_periods op on op.venue_id = v.id and op.schedule_version = v.active_schedule_version
                                                          and op.weekday = extract(dow from d.day)::integer
                            join public.resources r on r.venue_id = v.id and r.status = 'ACTIVE'))
    into v_occupancy;

  -- Repeat: customers with a paid booking starting in the period who had an earlier paid booking.
  select jsonb_build_object('customers', count(*), 'repeat_customers', count(*) filter (where c.earlier))
    into v_repeat
  from (select b.customer_id,
               exists (select 1 from public.bookings e
                       where e.customer_id = b.customer_id and e.confirmed_at is not null and e.start_at < min(b.start_at)) as earlier
        from public.bookings b
        where b.confirmed_at is not null and b.start_at >= v_start and b.start_at < v_end
          and (p_venue_id is null or b.venue_id = p_venue_id)
        group by b.customer_id) c;

  select jsonb_build_object(
           'extension_requests', (select count(*) from public.extension_requests x
                                  where x.created_at >= v_start and x.created_at < v_end and (p_venue_id is null or x.venue_id = p_venue_id)),
           'extensions_decided_in_time', (select count(*) from public.extension_requests x
                                          where x.created_at >= v_start and x.created_at < v_end
                                            and (p_venue_id is null or x.venue_id = p_venue_id)
                                            and x.decided_at is not null and x.decided_at <= x.request_expires_at),
           'extensions_applied', (select count(*) from public.extension_requests x
                                  where x.created_at >= v_start and x.created_at < v_end
                                    and (p_venue_id is null or x.venue_id = p_venue_id) and x.status = 'APPLIED'),
           'refunds_requested', (select count(*) from public.refunds f join public.bookings b on b.id = f.booking_id
                                 where f.created_at >= v_start and f.created_at < v_end and (p_venue_id is null or b.venue_id = p_venue_id)),
           'refunds_processed', (select count(*) from public.refunds f join public.bookings b on b.id = f.booking_id
                                 where f.created_at >= v_start and f.created_at < v_end and (p_venue_id is null or b.venue_id = p_venue_id)
                                   and f.status = 'PROCESSED'),
           'refunds_failed_or_unknown', (select count(*) from public.refunds f join public.bookings b on b.id = f.booking_id
                                         where f.created_at >= v_start and f.created_at < v_end
                                           and (p_venue_id is null or b.venue_id = p_venue_id) and f.status in ('FAILED', 'UNKNOWN')),
           'median_refund_minutes', (select round((percentile_cont(0.5) within group (
                                               order by extract(epoch from (f.processed_at - f.created_at)) / 60))::numeric, 1)
                                     from public.refunds f join public.bookings b on b.id = f.booking_id
                                     where f.created_at >= v_start and f.created_at < v_end
                                       and (p_venue_id is null or b.venue_id = p_venue_id) and f.status = 'PROCESSED'),
           'check_in_attempts', (select count(*) from public.arrival_attempts a
                                 where a.created_at >= v_start and a.created_at < v_end and (p_venue_id is null or a.venue_id = p_venue_id)),
           'check_in_failures', (select count(*) from public.arrival_attempts a
                                 where a.created_at >= v_start and a.created_at < v_end and (p_venue_id is null or a.venue_id = p_venue_id)
                                   and a.outcome = 'FAILED'),
           'end_reminders', (select count(*) from public.notifications n left join public.bookings b on b.id = n.booking_id
                             where n.channel = 'IN_APP' and n.template = 'booking_ending'
                               and n.created_at >= v_start and n.created_at < v_end
                               and (p_venue_id is null or b.venue_id = p_venue_id)))
    into v_reliability;

  if v_finance then
    select * into v_run from public.reconciliation_runs
     where status in ('MATCHED', 'MISMATCH') and period_from <= v_end and period_to >= v_start
       and environment = coalesce((select a.environment from public.payment_attempts a
                                   where a.state = 'CAPTURED' and a.captured_at >= v_start and a.captured_at < v_end
                                   group by a.environment order by count(*) desc limit 1), environment)
     order by completed_at desc limit 1;
    select jsonb_build_object(
             'collected_paise', (select coalesce(sum(a.amount_paise), 0)::bigint from public.payment_attempts a
                                 join public.bookings b on b.id = a.booking_id
                                 where a.state = 'CAPTURED' and a.captured_at >= v_start and a.captured_at < v_end
                                   and (p_venue_id is null or b.venue_id = p_venue_id)),
             'refunded_paise', (select coalesce(sum(f.amount_paise), 0)::bigint from public.refunds f
                                join public.bookings b on b.id = f.booking_id
                                where f.status = 'PROCESSED' and f.processed_at >= v_start and f.processed_at < v_end
                                  and (p_venue_id is null or b.venue_id = p_venue_id)),
             'earned_gross_paise', (select coalesce(sum(e.gross_paise), 0)::bigint from public.booking_earnings e
                                    where e.earned_at >= v_start and e.earned_at < v_end and (p_venue_id is null or e.venue_id = p_venue_id)),
             'platform_fee_paise', (select coalesce(sum(e.platform_fee_paise), 0)::bigint from public.booking_earnings e
                                    where e.earned_at >= v_start and e.earned_at < v_end and (p_venue_id is null or e.venue_id = p_venue_id)),
             'partner_earned_paise', (select coalesce(sum(e.partner_paise), 0)::bigint from public.booking_earnings e
                                      where e.earned_at >= v_start and e.earned_at < v_end and (p_venue_id is null or e.venue_id = p_venue_id)),
             'reconciliation', case when v_run.id is null then 'NONE'
                                    when v_run.status = 'MATCHED' and v_run.period_from <= v_start and v_run.period_to >= v_end then 'MATCHED'
                                    when v_run.status = 'MATCHED' then 'PARTIAL'
                                    else 'MISMATCH' end)
      into v_finance_block;
  end if;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'timezone', 'Asia/Kolkata', 'venue_id', p_venue_id,
    'funnel', v_funnel, 'outcomes', v_outcomes, 'occupancy', v_occupancy, 'repeat', v_repeat, 'reliability', v_reliability,
    'finance', v_finance_block, 'generated_at', clock_timestamp());
end;
$$;


grant execute on function app.admin_retry_refund(uuid, text, uuid) to authenticated;
-- Internal: refund_reserved, guard_policy_in_review.
revoke execute on all functions in schema app from public;
