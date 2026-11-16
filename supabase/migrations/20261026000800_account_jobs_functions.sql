-- M2.2 account lifecycle, M2.3 audited role grants, M2.5 durable outbox, notifications and idempotency.

-- Draft, synthetic terms identifiers. Real terms need owner/legal approval (docs/00 D03, D09).
create or replace function app.current_terms_version()
returns text language sql immutable set search_path = '' as $$ select 'draft-terms-2026-10-26'::text; $$;
create or replace function app.current_privacy_version()
returns text language sql immutable set search_path = '' as $$ select 'draft-privacy-2026-10-26'::text; $$;

create or replace function app.accept_terms(p_terms_version text, p_privacy_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_profile public.profiles;
begin
  if p_terms_version is distinct from app.current_terms_version()
     or p_privacy_version is distinct from app.current_privacy_version() then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object(
      'field', 'terms_version', 'current_terms_version', app.current_terms_version(),
      'current_privacy_version', app.current_privacy_version()));
  end if;
  update public.profiles
     set terms_version = p_terms_version, terms_accepted_at = now(), privacy_version = p_privacy_version
   where id = v_actor
   returning * into v_profile;
  return jsonb_build_object('terms_version', v_profile.terms_version, 'terms_accepted_at', v_profile.terms_accepted_at,
                            'version', v_profile.version);
end;
$$;

create or replace function app.update_my_profile(p_display_name text, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id = v_actor for update;
  if v_profile.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_profile.version));
  end if;
  if p_display_name is not null and char_length(trim(p_display_name)) not between 1 and 100 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'display_name'));
  end if;
  update public.profiles set display_name = nullif(trim(p_display_name), '') where id = v_actor returning * into v_profile;
  return jsonb_build_object('display_name', v_profile.display_name, 'version', v_profile.version);
end;
$$;

-- POST /privacy-requests. Requires a recent OTP/TOTP verification, read from the verified JWT's amr claim.
create or replace function app.request_privacy(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_status text;
  v_verified timestamptz;
  v_request public.privacy_requests;
begin
  if auth.uid() is null then
    perform app.fail('AUTH_REQUIRED');
  end if;
  select id, status into v_actor, v_status from public.profiles where auth_user_id = auth.uid();
  if v_actor is null or v_status = 'ANONYMIZED' then
    perform app.fail('AUTH_REQUIRED');
  end if;
  if p_kind is null or p_kind not in ('EXPORT', 'DELETE') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'kind'));
  end if;

  select to_timestamp(max((e ->> 'timestamp')::bigint)) into v_verified
  from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) as e
  where e ->> 'method' in ('otp', 'totp', 'magiclink');
  if v_verified is null or v_verified < clock_timestamp() - interval '15 minutes' then
    perform app.fail('REAUTH_REQUIRED', jsonb_build_object('reason', 'recent_verification'));
  end if;

  select * into v_request from public.privacy_requests
  where user_id = v_actor and kind = p_kind and status in ('REQUESTED', 'PROCESSING', 'NEEDS_REVIEW');
  if found then
    return jsonb_build_object('request_id', v_request.id, 'kind', v_request.kind, 'status', v_request.status, 'created', false);
  end if;

  insert into public.privacy_requests (user_id, kind, verified_at) values (v_actor, p_kind, v_verified)
    returning * into v_request;
  if p_kind = 'DELETE' then
    -- Blocks new bookings immediately; active commitments and financial retention are reviewed before erasure.
    update public.profiles set status = 'DELETION_PENDING' where id = v_actor and status = 'ACTIVE';
    perform app.enqueue_job('privacy:' || v_request.id || ':delete_requested', 'privacy.delete_requested',
                            jsonb_build_object('request_id', v_request.id));
  end if;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, safe_diff)
    values (v_actor, 'CUSTOMER', 'privacy.request', 'privacy_request', v_request.id, jsonb_build_object('kind', p_kind));
  return jsonb_build_object('request_id', v_request.id, 'kind', v_request.kind, 'status', v_request.status, 'created', true);
end;
$$;

-- Superadmin-only, MFA-verified, audited venue role grant (bootstrap and support for M2.3 tests).
create or replace function app.admin_grant_venue_membership(
  p_venue_id uuid, p_profile_id uuid, p_role text, p_reason text, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_membership public.venue_memberships;
begin
  if not app.has_platform_role(array['SUPERADMIN']) then
    perform app.fail('FORBIDDEN');
  end if;
  perform app.require_aal2();
  if p_role not in ('STAFF', 'MANAGER', 'OWNER') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'role'));
  end if;
  if p_reason is null or char_length(p_reason) not between 3 and 500 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason'));
  end if;
  if p_profile_id = v_actor then
    perform app.fail('FORBIDDEN', jsonb_build_object('reason', 'self_grant'));
  end if;
  insert into public.venue_memberships (venue_id, user_id, role, status, invited_by, accepted_at)
  values (p_venue_id, p_profile_id, p_role, 'ACTIVE', v_actor, now())
  on conflict (venue_id, user_id) do update set role = excluded.role, status = 'ACTIVE', accepted_at = now()
  returning * into v_membership;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, venue_id, request_id, reason, safe_diff)
  values (v_actor, 'SUPERADMIN', 'membership.grant', 'venue_membership', v_membership.id, p_venue_id, p_request_id, p_reason,
          jsonb_build_object('role', p_role, 'profile_id', p_profile_id));
  return jsonb_build_object('membership_id', v_membership.id, 'role', v_membership.role, 'status', v_membership.status);
end;
$$;

-- Outbox -----------------------------------------------------------------------------------------------------------

create or replace function app.enqueue_job(
  p_business_key text, p_kind text, p_payload jsonb, p_available_at timestamptz default null, p_max_attempts integer default 8
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.outbox_jobs (business_key, kind, safe_payload, available_at, max_attempts)
  values (p_business_key, p_kind, coalesce(p_payload, '{}'::jsonb), coalesce(p_available_at, now()), p_max_attempts)
  on conflict (business_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.outbox_jobs where business_key = p_business_key;
  end if;
  return v_id;
end;
$$;

-- Leases due jobs, including jobs whose previous lease expired (crashed worker). SKIP LOCKED prevents double leasing.
create or replace function app.lease_jobs(
  p_worker text, p_limit integer default 10, p_lease_seconds integer default 60, p_kinds text[] default null
)
returns setof public.outbox_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker is null or char_length(p_worker) not between 1 and 100 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'worker_id'));
  end if;
  -- A crashed lease that already used every attempt is dead-lettered instead of retried forever.
  update public.outbox_jobs j
     set status = 'DEAD', lease_until = null, leased_by = null,
         last_error_code = coalesce(j.last_error_code, 'LEASE_EXPIRED')
   where j.id in (
     select id from public.outbox_jobs
     where status = 'LEASED' and lease_until <= clock_timestamp() and attempts >= max_attempts
       and (p_kinds is null or kind = any (p_kinds))
     for update skip locked
   );

  return query
  update public.outbox_jobs j
     set status = 'LEASED',
         attempts = j.attempts + 1,
         lease_until = clock_timestamp() + make_interval(secs => greatest(5, least(p_lease_seconds, 900))),
         leased_by = p_worker
   where j.id in (
     select id from public.outbox_jobs
     where ((status = 'READY' and available_at <= clock_timestamp())
            or (status = 'LEASED' and lease_until <= clock_timestamp() and attempts < max_attempts))
       and (p_kinds is null or kind = any (p_kinds))
     order by available_at, id
     for update skip locked
     limit greatest(1, least(p_limit, 100))
   )
  returning j.*;
end;
$$;

-- Only the worker currently holding the lease can complete it; a worker whose lease was taken over gets false.
create or replace function app.complete_job(p_job_id uuid, p_worker text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.outbox_jobs
     set status = 'DONE', completed_at = clock_timestamp(), lease_until = null, leased_by = null, last_error_code = null
   where id = p_job_id and status = 'LEASED' and leased_by = p_worker;
  return found;
end;
$$;

-- Retryable failures back off exponentially (5 s, 10 s, 20 s ... capped at 15 min); then DEAD.
create or replace function app.fail_job(p_job_id uuid, p_worker text, p_error_code text, p_retryable boolean default true)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.outbox_jobs;
begin
  select * into v_job from public.outbox_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'LEASED' or v_job.leased_by is distinct from p_worker then
    return 'LEASE_LOST';
  end if;
  if not p_retryable or v_job.attempts >= v_job.max_attempts then
    update public.outbox_jobs
       set status = 'DEAD', lease_until = null, leased_by = null, last_error_code = left(p_error_code, 60)
     where id = p_job_id;
    return 'DEAD';
  end if;
  update public.outbox_jobs
     set status = 'READY', lease_until = null, leased_by = null, last_error_code = left(p_error_code, 60),
         available_at = clock_timestamp()
           + least(interval '15 minutes', make_interval(secs => 5 * power(2, greatest(v_job.attempts - 1, 0))))
   where id = p_job_id;
  return 'READY';
end;
$$;

create or replace function app.record_heartbeat(
  p_worker text, p_started_at timestamptz, p_ticks bigint, p_completed bigint, p_failed bigint, p_expired bigint,
  p_last_error_code text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.worker_heartbeats (worker_id, started_at, last_seen_at, ticks, jobs_completed, jobs_failed, holds_expired, last_error_code)
  values (p_worker, p_started_at, clock_timestamp(), p_ticks, p_completed, p_failed, p_expired, p_last_error_code)
  on conflict (worker_id) do update
    set last_seen_at = excluded.last_seen_at, ticks = excluded.ticks, jobs_completed = excluded.jobs_completed,
        jobs_failed = excluded.jobs_failed, holds_expired = excluded.holds_expired,
        last_error_code = excluded.last_error_code;
$$;

-- Job handlers (idempotent: replays create no duplicate rows) ------------------------------------------------------

create or replace function app.job_booking_hold_expired(p_booking_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_event text := 'booking:' || p_booking_id || ':hold_expired';
  v_email_id uuid;
  v_status text;
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found or v_booking.status <> 'EXPIRED' then
    return 0;
  end if;
  insert into public.notifications (user_id, booking_id, event_key, channel, template)
  values (v_booking.customer_id, v_booking.id, v_event, 'IN_APP', 'hold_expired'),
         (v_booking.customer_id, v_booking.id, v_event, 'EMAIL', 'hold_expired')
  on conflict (event_key, user_id, channel) do nothing;
  select id, status into v_email_id, v_status from public.notifications
  where event_key = v_event and user_id = v_booking.customer_id and channel = 'EMAIL';
  if v_status = 'QUEUED' then
    perform app.enqueue_job('notification:' || v_email_id || ':email', 'notification.email',
                            jsonb_build_object('notification_id', v_email_id));
    return 1;
  end if;
  return 0;
end;
$$;

-- Returns what the email adapter needs. Email address is read from auth.users only here, only for the worker.
create or replace function app.notification_delivery(p_notification_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'notification_id', n.id, 'status', n.status, 'template', n.template, 'channel', n.channel,
    'booking_public_ref', b.public_ref, 'to_email', u.email)
  from public.notifications n
  join public.profiles p on p.id = n.user_id
  left join auth.users u on u.id = p.auth_user_id
  left join public.bookings b on b.id = n.booking_id
  where n.id = p_notification_id;
$$;

create or replace function app.mark_notification(p_notification_id uuid, p_status text, p_provider_ref text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('SENT', 'FAILED') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'status'));
  end if;
  update public.notifications set status = p_status, provider_ref = left(p_provider_ref, 200)
   where id = p_notification_id and status = 'QUEUED';
  return found;
end;
$$;

create or replace function app.job_privacy_delete_requested(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.privacy_requests set status = 'NEEDS_REVIEW', safe_reason = 'Active commitments and retention review'
   where id = p_request_id and status in ('REQUESTED', 'PROCESSING')
   returning status into v_status;
  if v_status is null then
    select status into v_status from public.privacy_requests where id = p_request_id;
  end if;
  return v_status;
end;
$$;

-- Development diagnostic: records an effect once per business key; returns false on a replay.
create or replace function app.apply_diagnostic_effect(p_business_key text, p_worker text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.diagnostic_effects (business_key, worker_id) values (p_business_key, p_worker)
  on conflict (business_key) do nothing;
  return found;
end;
$$;

-- Admin operational metrics (superadmin/support, MFA).
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
    'workers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'worker_id', h.worker_id, 'last_seen_at', h.last_seen_at, 'ticks', h.ticks,
        'jobs_completed', h.jobs_completed, 'jobs_failed', h.jobs_failed, 'holds_expired', h.holds_expired,
        'last_error_code', h.last_error_code) order by h.last_seen_at desc)
      from public.worker_heartbeats h), '[]'::jsonb));
end;
$$;

-- Idempotency (docs/07 s.1). Begin and complete run in the same transaction as the domain write.
create or replace function app.idempotency_begin(p_route text, p_key uuid, p_request_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope text;
  v_id uuid;
  v_record public.idempotency_records;
begin
  if auth.uid() is null then
    perform app.fail('AUTH_REQUIRED');
  end if;
  if p_key is null or p_route is null or p_request_hash is null then
    perform app.fail('MALFORMED_REQUEST', jsonb_build_object('field', 'Idempotency-Key'));
  end if;
  v_scope := 'auth:' || auth.uid();
  insert into public.idempotency_records (actor_scope, route, key, request_hash, expires_at)
  values (v_scope, p_route, p_key, p_request_hash, now() + interval '7 days')
  on conflict (actor_scope, route, key) do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('state', 'NEW');
  end if;
  select * into v_record from public.idempotency_records where actor_scope = v_scope and route = p_route and key = p_key;
  if v_record.request_hash <> p_request_hash then
    perform app.fail('IDEMPOTENCY_CONFLICT');
  end if;
  if v_record.status = 'COMPLETE' then
    return jsonb_build_object('state', 'REPLAY', 'http_status', v_record.http_status, 'response', v_record.safe_response);
  end if;
  perform app.fail('OPERATION_IN_PROGRESS');
end;
$$;

create or replace function app.idempotency_complete(p_route text, p_key uuid, p_http_status integer, p_response jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.idempotency_records
     set status = 'COMPLETE', http_status = p_http_status, safe_response = p_response
   where actor_scope = 'auth:' || auth.uid() and route = p_route and key = p_key and status = 'IN_PROGRESS';
  if not found then
    perform app.fail('INTERNAL_ERROR', jsonb_build_object('reason', 'idempotency_record_missing'));
  end if;
end;
$$;

grant execute on function
  app.current_terms_version(), app.current_privacy_version()
  to anon, authenticated;
grant execute on function
  app.accept_terms(text, text), app.update_my_profile(text, integer), app.request_privacy(text),
  app.admin_grant_venue_membership(uuid, uuid, text, text, uuid), app.queue_metrics(),
  app.idempotency_begin(text, uuid, text), app.idempotency_complete(text, uuid, integer, jsonb)
  to authenticated;
grant execute on function
  app.lease_jobs(text, integer, integer, text[]), app.complete_job(uuid, text), app.fail_job(uuid, text, text, boolean),
  app.record_heartbeat(text, timestamptz, bigint, bigint, bigint, bigint, text),
  app.job_booking_hold_expired(uuid), app.notification_delivery(uuid), app.mark_notification(uuid, text, text),
  app.job_privacy_delete_requested(uuid), app.apply_diagnostic_effect(text, text)
  to simply_worker;
