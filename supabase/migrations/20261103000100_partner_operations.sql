-- M4.3 partner operations (docs/07 s.4; docs/03 P01-P08, A02; docs/08 T12, T14).
-- Partner writes need an assigned MANAGER/OWNER with TOTP (aal2), re-checked inside the transaction: venue staff get
-- FORBIDDEN, everyone else NOT_FOUND. Changes that affect sellable inventory take the venue -> resource lock path used
-- by holds and refuse (409 with references) rather than invalidate an active hold or booking. Never silent cancellation.

alter table public.venues
  add column status_reason text check (status_reason is null or char_length(status_reason) between 3 and 500),
  add column submitted_at timestamptz;
alter table public.resources
  add column pause_reason text check (pause_reason is null or char_length(pause_reason) between 3 and 500);
alter table public.venue_policies
  add column submitted_at timestamptz,
  add column review_reason text check (review_reason is null or char_length(review_reason) between 3 and 500);

alter table public.venue_media drop constraint venue_media_status_check;
alter table public.venue_media add constraint venue_media_status_check check (status in ('PENDING', 'APPROVED', 'REJECTED', 'REMOVED'));
alter table public.outbox_jobs drop constraint outbox_jobs_kind_check;
alter table public.outbox_jobs add constraint outbox_jobs_kind_check check (kind in (
  'booking.hold_expired', 'booking.confirmed', 'booking.cancelled', 'booking.no_show', 'notification.email',
  'privacy.delete_requested', 'diagnostic.sleep', 'payment.provider_event', 'refund.submit', 'refund.requested',
  'invitation.created'
));
alter table public.refunds drop constraint refunds_reason_code_check;
alter table public.refunds add constraint refunds_reason_code_check check (reason_code in (
  'LATE_CAPTURE', 'CANCELLED_HOLD_CAPTURE', 'DUPLICATE_CAPTURE', 'CUSTOMER_CANCEL', 'SERVICE_CANCEL', 'NO_SHOW'
));
alter table public.ledger_journals drop constraint ledger_journals_kind_check;
alter table public.ledger_journals add constraint ledger_journals_kind_check check (kind in (
  'CAPTURE_ALLOCATED_BOOKING', 'CAPTURE_REFUND_DUE', 'CAPTURE_QUARANTINED', 'REFUND_PROCESSED', 'CANCELLATION_REFUND_DUE',
  'NO_SHOW_REFUND_DUE'
));

-- Staff invitations. Acceptance needs a signed-in user whose verified Auth email matches; nothing secret is emailed.
create table public.venue_invitations (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id),
  email text not null check (char_length(email) between 3 and 254 and email = lower(email)),
  role text not null check (role in ('STAFF', 'MANAGER')),
  status text not null default 'INVITED' check (status in ('INVITED', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
  invited_by uuid not null references public.profiles (id),
  expires_at timestamptz not null,
  accepted_by uuid references public.profiles (id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
create unique index venue_invitations_one_open on public.venue_invitations (venue_id, email) where status = 'INVITED';
create index venue_invitations_email_idx on public.venue_invitations (email, status);
create trigger venue_invitations_touch before update on public.venue_invitations for each row execute function app.touch_row();
alter table public.venue_invitations enable row level security;
alter table public.venue_invitations force row level security;
-- No client grants: read and written only through the functions below.

create or replace function app.try_uuid(p_text text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

-- MANAGER/OWNER of the venue with TOTP; staff FORBIDDEN, others NOT_FOUND.
create or replace function app.require_venue_manager(p_venue_id uuid, p_roles text[] default array['MANAGER', 'OWNER'])
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
begin
  if p_venue_id is null or not app.is_venue_member(p_venue_id, p_roles) then
    if p_venue_id is not null and app.is_venue_member(p_venue_id) then
      perform app.fail('FORBIDDEN');
    end if;
    perform app.fail('NOT_FOUND');
  end if;
  perform app.require_aal2();
  return v_actor;
end;
$$;

create or replace function app.require_platform_admin(p_roles text[] default array['SUPPORT', 'SUPERADMIN'])
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
begin
  if not app.has_platform_role(p_roles) then
    perform app.fail('FORBIDDEN');
  end if;
  perform app.require_aal2();
  return v_actor;
end;
$$;

create or replace function app.audit(
  p_actor uuid, p_role text, p_action text, p_entity_type text, p_entity_id uuid, p_venue_id uuid, p_request_id uuid,
  p_reason text, p_diff jsonb default '{}'::jsonb
)
returns void
language sql
set search_path = ''
as $$
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, venue_id, request_id, reason, safe_diff)
  values (p_actor, p_role, p_action, p_entity_type, p_entity_id, p_venue_id, p_request_id, p_reason, coalesce(p_diff, '{}'::jsonb));
$$;

create or replace function app.manager_role(p_venue_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.is_venue_member(p_venue_id, array['OWNER']) then 'VENUE_OWNER' else 'VENUE_MANAGER' end;
$$;

-- Bookings that still occupy inventory from now on (holds included), with their references, for 409 details.
create or replace function app.future_commitments(p_resource_ids uuid[], p_from timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'public_ref', b.public_ref, 'booking_status', b.status, 'resource_label', r.label,
           'starts_at', b.start_at, 'ends_at', b.end_at, 'party_size', b.party_size) order by b.start_at), '[]'::jsonb)
  from public.inventory_claims c
  join public.bookings b on b.id = c.booking_id
  join public.resources r on r.id = c.resource_id
  where c.kind = 'BOOKING' and c.active and c.resource_id = any (p_resource_ids) and upper(c.blocked_range) > p_from;
$$;

-- Locks the venue and all its tables (sorted, as holds do) and releases due holds first.
create or replace function app.lock_venue_inventory(p_venue_id uuid)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_now timestamptz;
begin
  perform 1 from public.venues where id = p_venue_id for update;
  perform 1 from public.resources where venue_id = p_venue_id order by id for update;
  v_now := clock_timestamp();
  for v_id in select id from public.resources where venue_id = p_venue_id order by id loop
    perform app.expire_resource_holds(v_id, v_now);
  end loop;
  return v_now;
end;
$$;

create or replace function app.current_fee_config_version()
returns text
language sql
stable
set search_path = ''
as $$
  select config_version from public.fee_configurations
  where status = 'APPROVED' and effective_from <= now() order by effective_from desc limit 1;
$$;

-- P01: a signed-in user proposes a venue. Creates a PENDING partner, a DRAFT venue and their OWNER membership.
create or replace function app.partner_apply(
  p_legal_name text, p_venue_name text, p_category_code text, p_address text, p_locality text, p_lat double precision,
  p_lng double precision, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_partner uuid;
  v_venue public.venues;
  v_slug text;
begin
  perform app.require_current_terms(v_actor);
  if (select count(*) from public.venue_memberships m join public.venues v on v.id = m.venue_id
      where m.user_id = v_actor and m.role = 'OWNER' and v.status in ('DRAFT', 'PENDING_REVIEW')) >= 5 then
    perform app.fail('RATE_LIMITED', jsonb_build_object('reason', 'too_many_open_applications'));
  end if;
  if p_legal_name is null or char_length(trim(p_legal_name)) not between 2 and 200 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'partner_legal_name'));
  end if;
  if p_venue_name is null or char_length(trim(p_venue_name)) not between 2 and 120 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'venue_name'));
  end if;
  if not exists (select 1 from public.venue_categories where code = p_category_code and active) then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'category_code'));
  end if;
  if p_address is null or char_length(trim(p_address)) not between 5 and 300 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'address'));
  end if;
  if p_locality is null or char_length(trim(p_locality)) not between 2 and 120 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'locality'));
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'location'));
  end if;

  v_slug := left(trim(both '-' from regexp_replace(lower(trim(p_venue_name)), '[^a-z0-9]+', '-', 'g')), 60);
  if v_slug = '' then
    v_slug := 'venue';
  end if;
  v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.partners (legal_name, display_name, status)
  values (trim(p_legal_name), trim(p_venue_name), 'PENDING') returning id into v_partner;
  insert into public.venues (partner_id, category_code, name, slug, address, locality, location, status)
  values (v_partner, p_category_code, trim(p_venue_name), v_slug, trim(p_address), trim(p_locality),
          extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography, 'DRAFT')
  returning * into v_venue;
  insert into public.venue_memberships (venue_id, user_id, role, status, invited_by, accepted_at)
  values (v_venue.id, v_actor, 'OWNER', 'ACTIVE', v_actor, now());
  perform app.audit(v_actor, 'APPLICANT', 'partner.apply', 'venue', v_venue.id, v_venue.id, p_request_id, null,
                    jsonb_build_object('category_code', p_category_code));
  return jsonb_build_object('venue_id', v_venue.id, 'slug', v_venue.slug, 'status', v_venue.status, 'version', v_venue.version);
end;
$$;

-- P03 profile. Editable while DRAFT, PUBLISHED or PAUSED; a venue under review waits for the decision.
create or replace function app.partner_update_venue(p_venue_id uuid, p_fields jsonb, p_expected_version integer, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_venue_manager(p_venue_id);
  v_venue public.venues;
  v_key text;
  v_lat double precision;
  v_lng double precision;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'fields'));
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if v_key not in ('name', 'description', 'address', 'locality', 'category_code', 'lat', 'lng') then
      perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', v_key, 'reason', 'not_editable'));
    end if;
  end loop;
  select * into v_venue from public.venues where id = p_venue_id for update;
  if v_venue.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_venue.version));
  end if;
  if v_venue.status not in ('DRAFT', 'PUBLISHED', 'PAUSED') then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_venue.status));
  end if;
  if p_fields ? 'category_code' and not exists (
    select 1 from public.venue_categories where code = p_fields ->> 'category_code' and active
  ) then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'category_code'));
  end if;
  if (p_fields ? 'lat') <> (p_fields ? 'lng') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'location'));
  end if;
  if p_fields ? 'lat' then
    v_lat := (p_fields ->> 'lat')::double precision;
    v_lng := (p_fields ->> 'lng')::double precision;
    if v_lat not between -90 and 90 or v_lng not between -180 and 180 then
      perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'location'));
    end if;
  end if;
  begin
    update public.venues set
      name = coalesce(trim(p_fields ->> 'name'), name),
      description = coalesce(trim(p_fields ->> 'description'), description),
      address = coalesce(trim(p_fields ->> 'address'), address),
      locality = coalesce(trim(p_fields ->> 'locality'), locality),
      category_code = coalesce(p_fields ->> 'category_code', category_code),
      location = case when v_lat is null then location
                      else extensions.st_setsrid(extensions.st_makepoint(v_lng, v_lat), 4326)::extensions.geography end
    where id = p_venue_id returning * into v_venue;
  exception when check_violation or not_null_violation then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'invalid_value'));
  end;
  perform app.audit(v_actor, app.manager_role(p_venue_id), 'venue.update', 'venue', p_venue_id, p_venue_id, p_request_id, null,
                    jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(p_fields) k)));
  return jsonb_build_object('venue_id', v_venue.id, 'status', v_venue.status, 'version', v_venue.version);
end;
$$;

-- Pilot bounds for partner-set policy values (docs/00 proposed rules; owner decision D03 for the commercial ones).
create or replace function app.validate_policy_fields(p jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_int integer;
  v_bounds jsonb := jsonb_build_object(
    'cancel_cutoff_minutes', jsonb_build_array(0, 2880), 'early_refund_bps', jsonb_build_array(0, 10000),
    'late_refund_bps', jsonb_build_array(0, 10000), 'no_show_refund_bps', jsonb_build_array(0, 10000),
    'minimum_minutes', jsonb_build_array(30, 240), 'maximum_minutes', jsonb_build_array(30, 240),
    'buffer_minutes', jsonb_build_array(0, 60), 'grace_minutes', jsonb_build_array(0, 60),
    'lead_minutes', jsonb_build_array(0, 1440), 'max_horizon_days', jsonb_build_array(1, 90),
    'end_reminder_minutes', jsonb_build_array(0, 60));
begin
  for v_key in select jsonb_object_keys(p) loop
    if v_key in ('byo_food', 'outside_delivery') then
      if p ->> v_key not in ('ALLOWED', 'RESTRICTED', 'NOT_ALLOWED') then
        perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', v_key));
      end if;
    elsif v_key in ('byo_details', 'handover_instructions', 'house_rules') then
      if jsonb_typeof(p -> v_key) <> 'string' or char_length(trim(p ->> v_key)) < 3 then
        perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', v_key));
      end if;
    elsif v_key = 'increment_minutes' then
      if jsonb_typeof(p -> v_key) <> 'number' or (p ->> v_key) not in ('15', '30', '60') then
        perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', v_key));
      end if;
    elsif v_bounds ? v_key then
      if jsonb_typeof(p -> v_key) <> 'number' or (p ->> v_key) !~ '^[0-9]+$' then
        perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', v_key));
      end if;
      v_int := (p ->> v_key)::integer;
      if v_int < (v_bounds -> v_key ->> 0)::integer or v_int > (v_bounds -> v_key ->> 1)::integer then
        perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', v_key));
      end if;
    else
      perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', v_key, 'reason', 'not_editable'));
    end if;
  end loop;
end;
$$;

-- One editable draft per venue. Prefilled from the active policy (or pilot defaults); published policies never change.
create or replace function app.partner_save_policy_draft(p_venue_id uuid, p_fields jsonb, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_venue_manager(p_venue_id);
  v_draft public.venue_policies;
  v_base public.venue_policies;
  v_constraint text;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'fields'));
  end if;
  perform app.validate_policy_fields(p_fields);
  perform 1 from public.venues where id = p_venue_id for update;
  select * into v_draft from public.venue_policies where venue_id = p_venue_id and status = 'DRAFT'
  order by policy_version desc limit 1 for update;
  if found and v_draft.submitted_at is not null then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'draft_under_review'));
  end if;
  begin
    if not found then
      select p.* into v_base from public.venues v join public.venue_policies p on p.id = v.active_policy_id where v.id = p_venue_id;
      insert into public.venue_policies (
        venue_id, policy_version, status, source_policy_version, byo_food, byo_details, outside_delivery,
        handover_instructions, house_rules, cancel_cutoff_minutes, early_refund_bps, late_refund_bps, no_show_refund_bps,
        minimum_minutes, increment_minutes, maximum_minutes, buffer_minutes, grace_minutes, lead_minutes, max_horizon_days,
        hold_minutes, quote_ttl_minutes, end_reminder_minutes, effective_from, accepted_terms_version)
      values (
        p_venue_id,
        coalesce((select max(policy_version) from public.venue_policies where venue_id = p_venue_id), 0) + 1,
        'DRAFT', 'partner-draft',
        coalesce(p_fields ->> 'byo_food', v_base.byo_food, 'NOT_ALLOWED'),
        coalesce(p_fields ->> 'byo_details', v_base.byo_details, 'Outside food is not allowed.'),
        coalesce(p_fields ->> 'outside_delivery', v_base.outside_delivery, 'NOT_ALLOWED'),
        coalesce(p_fields ->> 'handover_instructions', v_base.handover_instructions, 'Show your booking code at the counter.'),
        coalesce(p_fields ->> 'house_rules', v_base.house_rules, 'Please keep noise considerate for other guests.'),
        coalesce((p_fields ->> 'cancel_cutoff_minutes')::integer, v_base.cancel_cutoff_minutes, 120),
        coalesce((p_fields ->> 'early_refund_bps')::integer, v_base.early_refund_bps, 10000),
        coalesce((p_fields ->> 'late_refund_bps')::integer, v_base.late_refund_bps, 0),
        coalesce((p_fields ->> 'no_show_refund_bps')::integer, v_base.no_show_refund_bps, 0),
        coalesce((p_fields ->> 'minimum_minutes')::integer, v_base.minimum_minutes, 60),
        coalesce((p_fields ->> 'increment_minutes')::integer, v_base.increment_minutes, 30),
        coalesce((p_fields ->> 'maximum_minutes')::integer, v_base.maximum_minutes, 240),
        coalesce((p_fields ->> 'buffer_minutes')::integer, v_base.buffer_minutes, 10),
        coalesce((p_fields ->> 'grace_minutes')::integer, v_base.grace_minutes, 15),
        coalesce((p_fields ->> 'lead_minutes')::integer, v_base.lead_minutes, 15),
        coalesce((p_fields ->> 'max_horizon_days')::integer, v_base.max_horizon_days, 30),
        coalesce(v_base.hold_minutes, 5), coalesce(v_base.quote_ttl_minutes, 5),
        coalesce((p_fields ->> 'end_reminder_minutes')::integer, v_base.end_reminder_minutes, 10),
        now(), app.current_terms_version())
      returning * into v_draft;
    else
      update public.venue_policies set
        byo_food = coalesce(p_fields ->> 'byo_food', byo_food),
        byo_details = coalesce(trim(p_fields ->> 'byo_details'), byo_details),
        outside_delivery = coalesce(p_fields ->> 'outside_delivery', outside_delivery),
        handover_instructions = coalesce(trim(p_fields ->> 'handover_instructions'), handover_instructions),
        house_rules = coalesce(trim(p_fields ->> 'house_rules'), house_rules),
        cancel_cutoff_minutes = coalesce((p_fields ->> 'cancel_cutoff_minutes')::integer, cancel_cutoff_minutes),
        early_refund_bps = coalesce((p_fields ->> 'early_refund_bps')::integer, early_refund_bps),
        late_refund_bps = coalesce((p_fields ->> 'late_refund_bps')::integer, late_refund_bps),
        no_show_refund_bps = coalesce((p_fields ->> 'no_show_refund_bps')::integer, no_show_refund_bps),
        minimum_minutes = coalesce((p_fields ->> 'minimum_minutes')::integer, minimum_minutes),
        increment_minutes = coalesce((p_fields ->> 'increment_minutes')::integer, increment_minutes),
        maximum_minutes = coalesce((p_fields ->> 'maximum_minutes')::integer, maximum_minutes),
        buffer_minutes = coalesce((p_fields ->> 'buffer_minutes')::integer, buffer_minutes),
        grace_minutes = coalesce((p_fields ->> 'grace_minutes')::integer, grace_minutes),
        lead_minutes = coalesce((p_fields ->> 'lead_minutes')::integer, lead_minutes),
        max_horizon_days = coalesce((p_fields ->> 'max_horizon_days')::integer, max_horizon_days),
        end_reminder_minutes = coalesce((p_fields ->> 'end_reminder_minutes')::integer, end_reminder_minutes),
        review_reason = null
      where id = v_draft.id returning * into v_draft;
    end if;
  exception when check_violation or not_null_violation then
    get stacked diagnostics v_constraint = constraint_name;
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'invalid_policy', 'constraint', v_constraint));
  end;
  perform app.audit(v_actor, app.manager_role(p_venue_id), 'policy.draft', 'venue_policy', v_draft.id, p_venue_id, p_request_id,
                    null, jsonb_build_object('policy_version', v_draft.policy_version));
  return jsonb_build_object('policy_id', v_draft.id, 'policy_version', v_draft.policy_version, 'status', v_draft.status,
                            'version', v_draft.version);
end;
$$;

-- A policy change on a live venue goes to platform review; a new venue's draft is reviewed with the venue.
create or replace function app.partner_submit_policy(p_venue_id uuid, p_policy_id uuid, p_expected_version integer, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_venue_manager(p_venue_id);
  v_policy public.venue_policies;
  v_status text;
begin
  select status into v_status from public.venues where id = p_venue_id for update;
  if v_status not in ('PUBLISHED', 'PAUSED') then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'submit_with_venue'));
  end if;
  select * into v_policy from public.venue_policies where id = p_policy_id and venue_id = p_venue_id for update;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  if v_policy.status <> 'DRAFT' or v_policy.submitted_at is not null then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_policy.status));
  end if;
  if v_policy.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_policy.version));
  end if;
  update public.venue_policies set submitted_at = now() where id = p_policy_id returning * into v_policy;
  perform app.audit(v_actor, app.manager_role(p_venue_id), 'policy.submit', 'venue_policy', p_policy_id, p_venue_id, p_request_id, null);
  return jsonb_build_object('policy_id', v_policy.id, 'status', 'SUBMITTED', 'version', v_policy.version);
end;
$$;

-- P04 tables. A new table gets its first rate (current approved fee configuration) in the same transaction.
create or replace function app.partner_create_resource(
  p_venue_id uuid, p_label text, p_capacity integer, p_hourly_paise bigint, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_venue_manager(p_venue_id);
  v_resource public.resources;
  v_fee text;
begin
  if p_label is null or char_length(trim(p_label)) not between 1 and 80 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'label'));
  end if;
  if p_capacity is null or p_capacity not between 1 and 50 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'capacity'));
  end if;
  if p_hourly_paise is null or p_hourly_paise not between 100 and 10000000 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'hourly_paise'));
  end if;
  v_fee := app.current_fee_config_version();
  if v_fee is null then
    perform app.fail('POLICY_NOT_CONFIGURED', jsonb_build_object('field', 'fee_configuration'));
  end if;
  perform 1 from public.venues where id = p_venue_id and status <> 'REJECTED' for update;
  if not found then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', 'REJECTED'));
  end if;
  if exists (select 1 from public.resources where venue_id = p_venue_id and lower(label) = lower(trim(p_label))) then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'label', 'reason', 'duplicate'));
  end if;
  if (select count(*) from public.resources where venue_id = p_venue_id and status <> 'RETIRED') >= 100 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'label', 'reason', 'too_many_tables'));
  end if;
  insert into public.resources (venue_id, label, capacity) values (p_venue_id, trim(p_label), p_capacity) returning * into v_resource;
  insert into public.resource_rates (resource_id, rate_version, hourly_paise, effective_from, fee_config_version)
  values (v_resource.id, 1, p_hourly_paise, clock_timestamp(), v_fee);
  perform app.audit(v_actor, app.manager_role(p_venue_id), 'resource.create', 'resource', v_resource.id, p_venue_id, p_request_id,
                    null, jsonb_build_object('capacity', p_capacity, 'hourly_paise', p_hourly_paise));
  return jsonb_build_object('resource_id', v_resource.id, 'label', v_resource.label, 'status', v_resource.status,
                            'version', v_resource.version);
end;
$$;

-- Resource writes after the first: lock the venue (and its tables) like a hold, then the resource row.
create or replace function app.lock_partner_resource(p_resource_id uuid, p_roles text[] default array['MANAGER', 'OWNER'])
returns public.resources
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue uuid;
  v_resource public.resources;
begin
  select venue_id into v_venue from public.resources where id = p_resource_id;
  perform app.require_venue_manager(v_venue, p_roles);
  perform app.lock_venue_inventory(v_venue);
  select * into v_resource from public.resources where id = p_resource_id;
  return v_resource;
end;
$$;

create or replace function app.partner_update_resource(
  p_resource_id uuid, p_label text, p_capacity integer, p_expected_version integer, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_resource public.resources := app.lock_partner_resource(p_resource_id);
  v_conflicts jsonb;
begin
  if v_resource.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_resource.version));
  end if;
  if v_resource.status = 'RETIRED' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_resource.status));
  end if;
  if p_label is not null and (char_length(trim(p_label)) not between 1 and 80 or exists (
    select 1 from public.resources where venue_id = v_resource.venue_id and id <> p_resource_id and lower(label) = lower(trim(p_label))
  )) then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'label'));
  end if;
  if p_capacity is not null and p_capacity not between 1 and 50 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'capacity'));
  end if;
  if p_capacity is not null and p_capacity < v_resource.capacity then
    select coalesce(jsonb_agg(c) filter (where (c ->> 'party_size')::integer > p_capacity), '[]'::jsonb) into v_conflicts
    from jsonb_array_elements(app.future_commitments(array[p_resource_id], clock_timestamp())) c;
    if jsonb_array_length(v_conflicts) > 0 then
      perform app.fail('SLOT_UNAVAILABLE', jsonb_build_object('reason', 'capacity_conflict', 'conflicts', v_conflicts));
    end if;
  end if;
  update public.resources set label = coalesce(trim(p_label), label), capacity = coalesce(p_capacity, capacity)
  where id = p_resource_id returning * into v_resource;
  perform app.audit(v_actor, app.manager_role(v_resource.venue_id), 'resource.update', 'resource', p_resource_id, v_resource.venue_id,
                    p_request_id, null, jsonb_build_object('label', p_label is not null, 'capacity', p_capacity));
  return jsonb_build_object('resource_id', v_resource.id, 'label', v_resource.label, 'capacity', v_resource.capacity,
                            'version', v_resource.version);
end;
$$;

-- New rate version from a future (or immediate) instant; the open version is closed there. Existing quotes and booking
-- snapshots keep their prices; quotes use the rate effective at the requested start.
create or replace function app.partner_set_rate(
  p_resource_id uuid, p_hourly_paise bigint, p_effective_from timestamptz, p_expected_version integer, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_resource public.resources := app.lock_partner_resource(p_resource_id);
  v_from timestamptz := greatest(coalesce(p_effective_from, clock_timestamp()), clock_timestamp());
  v_open public.resource_rates;
  v_fee text := app.current_fee_config_version();
  v_rate public.resource_rates;
begin
  if v_resource.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_resource.version));
  end if;
  if v_resource.status = 'RETIRED' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_resource.status));
  end if;
  if p_hourly_paise is null or p_hourly_paise not between 100 and 10000000 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'hourly_paise'));
  end if;
  if p_effective_from is not null and p_effective_from < clock_timestamp() - interval '1 minute' then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'effective_from', 'reason', 'past'));
  end if;
  if v_fee is null then
    perform app.fail('POLICY_NOT_CONFIGURED', jsonb_build_object('field', 'fee_configuration'));
  end if;
  select * into v_open from public.resource_rates where resource_id = p_resource_id and effective_to is null for update;
  if found then
    if v_open.effective_from >= v_from then
      perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'future_rate_pending'));
    end if;
    update public.resource_rates set effective_to = v_from where id = v_open.id;
  end if;
  insert into public.resource_rates (resource_id, rate_version, hourly_paise, effective_from, fee_config_version)
  values (p_resource_id, coalesce((select max(rate_version) from public.resource_rates where resource_id = p_resource_id), 0) + 1,
          p_hourly_paise, v_from, v_fee)
  returning * into v_rate;
  update public.resources set updated_at = now() where id = p_resource_id returning * into v_resource;
  perform app.audit(v_actor, app.manager_role(v_resource.venue_id), 'rate.create', 'resource', p_resource_id, v_resource.venue_id,
                    p_request_id, null, jsonb_build_object('hourly_paise', p_hourly_paise, 'effective_from', v_from,
                                                           'rate_version', v_rate.rate_version));
  return jsonb_build_object('resource_id', p_resource_id, 'rate_version', v_rate.rate_version, 'hourly_paise', v_rate.hourly_paise,
                            'effective_from', v_rate.effective_from, 'version', v_resource.version);
end;
$$;

-- Pause stops new holds on this table at once; existing holds/bookings stay for explicit resolution (returned).
create or replace function app.partner_set_resource_status(
  p_resource_id uuid, p_action text, p_reason text, p_expected_version integer, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_resource public.resources := app.lock_partner_resource(
    p_resource_id, case when p_action = 'RETIRE' then array['OWNER'] else array['MANAGER', 'OWNER'] end);
  v_commitments jsonb;
begin
  if v_resource.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_resource.version));
  end if;
  v_commitments := app.future_commitments(array[p_resource_id], clock_timestamp());
  if p_action = 'PAUSE' then
    if v_resource.status <> 'ACTIVE' then
      perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_resource.status));
    end if;
    if p_reason is null or char_length(trim(p_reason)) not between 3 and 500 then
      perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason'));
    end if;
    update public.resources set status = 'PAUSED', pause_reason = trim(p_reason) where id = p_resource_id returning * into v_resource;
  elsif p_action = 'RESUME' then
    if v_resource.status <> 'PAUSED' then
      perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_resource.status));
    end if;
    if not exists (select 1 from public.resource_rates where resource_id = p_resource_id and effective_to is null) then
      perform app.fail('POLICY_NOT_CONFIGURED', jsonb_build_object('field', 'rate'));
    end if;
    update public.resources set status = 'ACTIVE', pause_reason = null where id = p_resource_id returning * into v_resource;
  elsif p_action = 'RETIRE' then
    if v_resource.status = 'RETIRED' then
      perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_resource.status));
    end if;
    if jsonb_array_length(v_commitments) > 0 then
      perform app.fail('SLOT_UNAVAILABLE', jsonb_build_object('reason', 'future_commitments', 'conflicts', v_commitments));
    end if;
    if p_reason is null or char_length(trim(p_reason)) not between 3 and 500 then
      perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason'));
    end if;
    update public.resources set status = 'RETIRED', pause_reason = trim(p_reason) where id = p_resource_id returning * into v_resource;
  else
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'action'));
  end if;
  perform app.audit(v_actor, app.manager_role(v_resource.venue_id), 'resource.' || lower(p_action), 'resource', p_resource_id,
                    v_resource.venue_id, p_request_id, p_reason, jsonb_build_object('status', v_resource.status));
  return jsonb_build_object('resource_id', v_resource.id, 'status', v_resource.status, 'version', v_resource.version,
                            'future_commitments', v_commitments);
end;
$$;

-- Atomic all-period replacement as a new schedule version. Refused (409 with references) if a future hold/booking
-- would no longer fit; the manager resolves those bookings first (pause, service cancel), then retries.
create or replace function app.partner_set_hours(p_venue_id uuid, p_periods jsonb, p_expected_version integer, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_venue_manager(p_venue_id);
  v_venue public.venues;
  v_version integer;
  v_period jsonb;
  v_opens time;
  v_closes time;
  v_conflicts jsonb;
  v_now timestamptz;
begin
  if p_periods is null or jsonb_typeof(p_periods) <> 'array' or jsonb_array_length(p_periods) > 21 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'periods'));
  end if;
  v_now := app.lock_venue_inventory(p_venue_id);
  select * into v_venue from public.venues where id = p_venue_id;
  if v_venue.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_venue.version));
  end if;
  v_version := coalesce((select max(schedule_version) from public.opening_periods where venue_id = p_venue_id), 0) + 1;
  for v_period in select * from jsonb_array_elements(p_periods) loop
    if jsonb_typeof(v_period) <> 'object' or (v_period ->> 'weekday') !~ '^[0-6]$'
       or (v_period ->> 'opens_local') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or (v_period ->> 'closes_local') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'periods'));
    end if;
    v_opens := (v_period ->> 'opens_local')::time;
    v_closes := (v_period ->> 'closes_local')::time;
    insert into public.opening_periods (venue_id, weekday, opens_local, closes_local, closes_next_day, schedule_version)
    values (p_venue_id, (v_period ->> 'weekday')::smallint, v_opens, v_closes, v_closes <= v_opens, v_version);
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('public_ref', b.public_ref, 'booking_status', b.status, 'resource_label', r.label,
                                               'starts_at', b.start_at, 'ends_at', b.end_at) order by b.start_at), '[]'::jsonb)
    into v_conflicts
  from public.inventory_claims c
  join public.bookings b on b.id = c.booking_id
  join public.resources r on r.id = c.resource_id
  where c.venue_id = p_venue_id and c.kind = 'BOOKING' and c.active and upper(c.blocked_range) > v_now
    and not app.within_opening_hours(p_venue_id, v_version, v_venue.timezone, lower(c.blocked_range), upper(c.blocked_range));
  if jsonb_array_length(v_conflicts) > 0 then
    perform app.fail('SLOT_UNAVAILABLE', jsonb_build_object('reason', 'hours_conflict', 'conflicts', v_conflicts));
  end if;
  update public.venues set active_schedule_version = v_version where id = p_venue_id returning * into v_venue;
  perform app.audit(v_actor, app.manager_role(p_venue_id), 'hours.replace', 'venue', p_venue_id, p_venue_id, p_request_id, null,
                    jsonb_build_object('schedule_version', v_version, 'periods', jsonb_array_length(p_periods)));
  return jsonb_build_object('venue_id', p_venue_id, 'schedule_version', v_version, 'version', v_venue.version);
end;
$$;

create or replace function app.partner_set_amenities_tags(
  p_venue_id uuid, p_amenities jsonb, p_tags jsonb, p_expected_version integer, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_venue_manager(p_venue_id);
  v_venue public.venues;
  v_item jsonb;
begin
  if jsonb_typeof(p_amenities) <> 'array' or jsonb_typeof(p_tags) <> 'array'
     or jsonb_array_length(p_amenities) > 20 or jsonb_array_length(p_tags) > 20 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'amenities'));
  end if;
  select * into v_venue from public.venues where id = p_venue_id for update;
  if v_venue.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_venue.version));
  end if;
  begin
    delete from public.venue_amenities a
    where a.venue_id = p_venue_id
      and not exists (select 1 from jsonb_array_elements(p_amenities) x where x ->> 'code' = a.code);
    for v_item in select * from jsonb_array_elements(p_amenities) loop
      insert into public.venue_amenities (venue_id, code, details)
      values (p_venue_id, v_item ->> 'code', nullif(trim(v_item ->> 'details'), ''))
      on conflict (venue_id, code) do update
        set details = excluded.details,
            -- A changed accessibility description needs fresh verification.
            verified_at = case when public.venue_amenities.details is distinct from excluded.details then null
                               else public.venue_amenities.verified_at end,
            verified_by = case when public.venue_amenities.details is distinct from excluded.details then null
                               else public.venue_amenities.verified_by end;
    end loop;
    delete from public.venue_tags where venue_id = p_venue_id;
    insert into public.venue_tags (venue_id, tag_group, tag_code)
    select distinct p_venue_id, x ->> 'group', x ->> 'code' from jsonb_array_elements(p_tags) x;
  exception when check_violation or not_null_violation or unique_violation then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'amenities_or_tags'));
  end;
  update public.venues set updated_at = now() where id = p_venue_id returning * into v_venue;
  perform app.audit(v_actor, app.manager_role(p_venue_id), 'catalogue.replace', 'venue', p_venue_id, p_venue_id, p_request_id, null,
                    jsonb_build_object('amenities', jsonb_array_length(p_amenities), 'tags', jsonb_array_length(p_tags)));
  return jsonb_build_object('venue_id', p_venue_id, 'version', v_venue.version);
end;
$$;

-- Photos: the server uploads the file to private Storage first (as the manager), then records it here as PENDING.
create or replace function app.partner_add_media(
  p_venue_id uuid, p_media_id uuid, p_storage_key text, p_alt_text text, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_venue_manager(p_venue_id);
  v_media public.venue_media;
begin
  if p_storage_key is null or p_storage_key !~ ('^' || p_venue_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'storage_key'));
  end if;
  if p_alt_text is null or char_length(trim(p_alt_text)) not between 3 and 250 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'alt_text'));
  end if;
  perform 1 from public.venues where id = p_venue_id for update;
  if (select count(*) from public.venue_media where venue_id = p_venue_id and status in ('PENDING', 'APPROVED')) >= 12 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'media', 'reason', 'too_many'));
  end if;
  insert into public.venue_media (id, venue_id, storage_key, alt_text, sort_order)
  values (p_media_id, p_venue_id, p_storage_key, trim(p_alt_text),
          coalesce((select max(sort_order) from public.venue_media where venue_id = p_venue_id), 0) + 1)
  returning * into v_media;
  perform app.audit(v_actor, app.manager_role(p_venue_id), 'media.add', 'venue_media', v_media.id, p_venue_id, p_request_id, null);
  return jsonb_build_object('media_id', v_media.id, 'status', v_media.status);
end;
$$;

create or replace function app.partner_remove_media(p_media_id uuid, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue uuid := (select venue_id from public.venue_media where id = p_media_id);
  v_actor uuid := app.require_venue_manager(v_venue);
begin
  update public.venue_media set status = 'REMOVED' where id = p_media_id and status <> 'REMOVED';
  perform app.audit(v_actor, app.manager_role(v_venue), 'media.remove', 'venue_media', p_media_id, v_venue, p_request_id, null);
  return jsonb_build_object('media_id', p_media_id, 'status', 'REMOVED');
end;
$$;

-- What is missing before a venue can be reviewed (also re-checked at approval).
create or replace function app.venue_publication_gaps(p_venue_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(gap), '[]'::jsonb) from (
    select 'description' as gap from public.venues where id = p_venue_id and char_length(description) < 30
    union all
    select 'policy' where not exists (
      select 1 from public.venue_policies p where p.venue_id = p_venue_id
        and (p.status = 'PUBLISHED' or p.status = 'DRAFT'))
    union all
    select 'priced_table' where not exists (
      select 1 from public.resources r join public.resource_rates rr on rr.resource_id = r.id
      where r.venue_id = p_venue_id and r.status = 'ACTIVE' and rr.effective_to is null)
    union all
    select 'hours' where not exists (
      select 1 from public.opening_periods o join public.venues v on v.id = o.venue_id
      where v.id = p_venue_id and o.schedule_version = v.active_schedule_version)
    union all
    select 'photo' where not exists (
      select 1 from public.venue_media m where m.venue_id = p_venue_id and m.status in ('PENDING', 'APPROVED'))
    union all
    select 'requirement_tag' where not exists (
      select 1 from public.venue_tags t where t.venue_id = p_venue_id and t.tag_group = 'REQUIREMENT')
  ) gaps;
$$;

create or replace function app.partner_submit_venue(p_venue_id uuid, p_expected_version integer, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_venue_manager(p_venue_id);
  v_venue public.venues;
  v_gaps jsonb;
begin
  select * into v_venue from public.venues where id = p_venue_id for update;
  if v_venue.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_venue.version));
  end if;
  if v_venue.status <> 'DRAFT' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_venue.status));
  end if;
  v_gaps := app.venue_publication_gaps(p_venue_id);
  if jsonb_array_length(v_gaps) > 0 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'incomplete', 'missing', v_gaps));
  end if;
  update public.venues set status = 'PENDING_REVIEW', submitted_at = now(), status_reason = null
  where id = p_venue_id returning * into v_venue;
  perform app.audit(v_actor, app.manager_role(p_venue_id), 'venue.submit', 'venue', p_venue_id, p_venue_id, p_request_id, null);
  return jsonb_build_object('venue_id', p_venue_id, 'status', v_venue.status, 'version', v_venue.version);
end;
$$;

-- A02: approve publishes the policy draft (if no active policy) and pending photos; pause stops new sales and lists
-- the future bookings that need assessment (nothing is cancelled automatically).
create or replace function app.admin_review_venue(
  p_venue_id uuid, p_decision text, p_reason text, p_expected_version integer, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_platform_admin();
  v_venue public.venues;
  v_draft public.venue_policies;
  v_gaps jsonb;
  v_affected jsonb := '[]'::jsonb;
begin
  if p_reason is null or char_length(trim(p_reason)) not between 3 and 500 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason'));
  end if;
  perform app.lock_venue_inventory(p_venue_id);
  select * into v_venue from public.venues where id = p_venue_id;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  if v_venue.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_venue.version));
  end if;
  if p_decision = 'APPROVE' then
    if v_venue.status <> 'PENDING_REVIEW' then
      perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_venue.status));
    end if;
    v_gaps := app.venue_publication_gaps(p_venue_id);
    if jsonb_array_length(v_gaps) > 0 then
      perform app.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'incomplete', 'missing', v_gaps));
    end if;
    select * into v_draft from public.venue_policies where venue_id = p_venue_id and status = 'DRAFT'
    order by policy_version desc limit 1 for update;
    if found then
      update public.venue_policies set status = 'PUBLISHED', effective_from = now(), submitted_at = null where id = v_draft.id;
      update public.venues set active_policy_id = v_draft.id where id = p_venue_id;
    end if;
    update public.venue_media set status = 'APPROVED' where venue_id = p_venue_id and status = 'PENDING';
    update public.partners set status = 'APPROVED' where id = v_venue.partner_id and status = 'PENDING';
    update public.venues set status = 'PUBLISHED', published_at = coalesce(published_at, now()), status_reason = null
    where id = p_venue_id returning * into v_venue;
  elsif p_decision in ('REQUEST_CHANGES', 'REJECT') then
    if v_venue.status <> 'PENDING_REVIEW' then
      perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_venue.status));
    end if;
    update public.venues set status = case when p_decision = 'REJECT' then 'REJECTED' else 'DRAFT' end, status_reason = trim(p_reason)
    where id = p_venue_id returning * into v_venue;
  elsif p_decision = 'PAUSE' then
    if v_venue.status <> 'PUBLISHED' then
      perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_venue.status));
    end if;
    v_affected := app.future_commitments(array(select id from public.resources where venue_id = p_venue_id), clock_timestamp());
    update public.venues set status = 'PAUSED', status_reason = trim(p_reason) where id = p_venue_id returning * into v_venue;
  elsif p_decision = 'RESUME' then
    if v_venue.status <> 'PAUSED' then
      perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_venue.status));
    end if;
    update public.venues set status = 'PUBLISHED', status_reason = null where id = p_venue_id returning * into v_venue;
  else
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'decision'));
  end if;
  perform app.audit(v_actor, 'PLATFORM_ADMIN', 'venue.review', 'venue', p_venue_id, p_venue_id, p_request_id, trim(p_reason),
                    jsonb_build_object('decision', p_decision, 'status', v_venue.status, 'affected', jsonb_array_length(v_affected)));
  return jsonb_build_object('venue_id', p_venue_id, 'status', v_venue.status, 'version', v_venue.version,
                            'affected_bookings', v_affected);
end;
$$;

-- Live-venue policy change review. Approval publishes it for new quotes only.
create or replace function app.admin_review_policy(
  p_policy_id uuid, p_decision text, p_reason text, p_expected_version integer, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_platform_admin();
  v_policy public.venue_policies;
begin
  if p_reason is null or char_length(trim(p_reason)) not between 3 and 500 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason'));
  end if;
  select * into v_policy from public.venue_policies where id = p_policy_id;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  perform 1 from public.venues where id = v_policy.venue_id for update;
  select * into v_policy from public.venue_policies where id = p_policy_id for update;
  if v_policy.status <> 'DRAFT' or v_policy.submitted_at is null then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_policy.status));
  end if;
  if v_policy.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_policy.version));
  end if;
  if p_decision = 'APPROVE' then
    update public.venue_policies set status = 'PUBLISHED', effective_from = now(), submitted_at = null, review_reason = null
    where id = p_policy_id returning * into v_policy;
    update public.venues set active_policy_id = p_policy_id where id = v_policy.venue_id;
  elsif p_decision = 'REQUEST_CHANGES' then
    update public.venue_policies set submitted_at = null, review_reason = trim(p_reason) where id = p_policy_id returning * into v_policy;
  else
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'decision'));
  end if;
  perform app.audit(v_actor, 'PLATFORM_ADMIN', 'policy.review', 'venue_policy', p_policy_id, v_policy.venue_id, p_request_id,
                    trim(p_reason), jsonb_build_object('decision', p_decision));
  return jsonb_build_object('policy_id', p_policy_id, 'status', v_policy.status, 'version', v_policy.version);
end;
$$;

create or replace function app.admin_review_media(p_media_id uuid, p_decision text, p_reason text, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_platform_admin();
  v_media public.venue_media;
begin
  if p_decision not in ('APPROVE', 'REJECT') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'decision'));
  end if;
  update public.venue_media set status = case when p_decision = 'APPROVE' then 'APPROVED' else 'REJECTED' end
  where id = p_media_id and status = 'PENDING' returning * into v_media;
  if not found then
    perform app.fail('INVALID_TRANSITION');
  end if;
  perform app.audit(v_actor, 'PLATFORM_ADMIN', 'media.review', 'venue_media', p_media_id, v_media.venue_id, p_request_id, p_reason,
                    jsonb_build_object('decision', p_decision));
  return jsonb_build_object('media_id', p_media_id, 'status', v_media.status);
end;
$$;

create or replace function app.partner_release_closure(p_claim_id uuid, p_reason text, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.inventory_claims;
  v_actor uuid;
begin
  select * into v_claim from public.inventory_claims where id = p_claim_id and kind = 'CLOSURE';
  v_actor := app.require_venue_manager(v_claim.venue_id);
  if p_reason is null or char_length(trim(p_reason)) not between 3 and 500 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason'));
  end if;
  perform 1 from public.venues where id = v_claim.venue_id for update;
  perform 1 from public.resources where id = v_claim.resource_id for update;
  update public.inventory_claims set active = false, released_at = clock_timestamp()
  where id = p_claim_id and active returning * into v_claim;
  if not found then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'already_released'));
  end if;
  perform app.audit(v_actor, app.manager_role(v_claim.venue_id), 'closure.release', 'inventory_claim', p_claim_id, v_claim.venue_id,
                    p_request_id, trim(p_reason));
  return jsonb_build_object('closure_id', p_claim_id, 'active', false);
end;
$$;

-- P08 staff invitations ------------------------------------------------------------------------------------------
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
  where venue_id = p_venue_id and email = v_email and status = 'INVITED' and expires_at <= now();
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

-- The caller's verified Auth email, lower-cased (never taken from the request).
create or replace function app.my_auth_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email) from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
$$;

create or replace function app.my_invitations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('invitation_id', i.id, 'venue_id', i.venue_id, 'venue_name', v.name, 'role', i.role,
                                        'expires_at', i.expires_at) order by i.created_at)
    from public.venue_invitations i join public.venues v on v.id = i.venue_id
    where i.email = app.my_auth_email() and i.status = 'INVITED' and i.expires_at > now()), '[]'::jsonb);
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
    update public.venue_invitations set status = 'EXPIRED' where id = p_invitation_id and status = 'INVITED';
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

-- Managers remove STAFF; owners also MANAGER/OWNER. Nobody removes themselves or the last owner.
create or replace function app.partner_revoke_member(p_membership_id uuid, p_expected_version integer, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.venue_memberships;
  v_actor uuid;
begin
  select * into v_membership from public.venue_memberships where id = p_membership_id;
  v_actor := app.require_venue_manager(v_membership.venue_id);
  perform 1 from public.venues where id = v_membership.venue_id for update;
  select * into v_membership from public.venue_memberships where id = p_membership_id for update;
  if v_membership.status <> 'ACTIVE' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_membership.status));
  end if;
  if v_membership.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_membership.version));
  end if;
  if v_membership.user_id = v_actor then
    perform app.fail('FORBIDDEN', jsonb_build_object('reason', 'self_revoke'));
  end if;
  if v_membership.role <> 'STAFF' and not app.is_venue_member(v_membership.venue_id, array['OWNER']) then
    perform app.fail('FORBIDDEN', jsonb_build_object('reason', 'owner_only'));
  end if;
  if v_membership.role = 'OWNER' and (
    select count(*) from public.venue_memberships where venue_id = v_membership.venue_id and role = 'OWNER' and status = 'ACTIVE'
  ) <= 1 then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'last_owner'));
  end if;
  update public.venue_memberships set status = 'REVOKED' where id = p_membership_id returning * into v_membership;
  perform app.audit(v_actor, app.manager_role(v_membership.venue_id), 'membership.revoke', 'venue_membership', p_membership_id,
                    v_membership.venue_id, p_request_id, null, jsonb_build_object('role', v_membership.role));
  return jsonb_build_object('membership_id', p_membership_id, 'status', v_membership.status, 'version', v_membership.version);
end;
$$;

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
  update public.venue_invitations set status = 'REVOKED' where id = p_invitation_id and status = 'INVITED' returning * into v_invitation;
  if not found then
    perform app.fail('INVALID_TRANSITION');
  end if;
  perform app.audit(v_actor, app.manager_role(v_invitation.venue_id), 'invitation.revoke', 'venue_invitation', p_invitation_id,
                    v_invitation.venue_id, p_request_id, null);
  return jsonb_build_object('invitation_id', p_invitation_id, 'status', 'REVOKED');
end;
$$;

create or replace function app.partner_staff(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_venue_manager(p_venue_id);
begin
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('membership_id', m.id, 'role', m.role, 'status', m.status, 'email', lower(u.email),
                                          'display_name', p.display_name, 'accepted_at', m.accepted_at, 'version', m.version,
                                          'is_self', m.user_id = v_actor) order by m.role, m.created_at)
      from public.venue_memberships m join public.profiles p on p.id = m.user_id left join auth.users u on u.id = p.auth_user_id
      where m.venue_id = p_venue_id and m.status = 'ACTIVE'), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object('invitation_id', i.id, 'email', i.email, 'role', i.role,
                                          'status', case when i.expires_at <= now() then 'EXPIRED' else i.status end,
                                          'expires_at', i.expires_at) order by i.created_at desc)
      from public.venue_invitations i where i.venue_id = p_venue_id and i.status = 'INVITED'), '[]'::jsonb),
    'can_invite_managers', app.is_venue_member(p_venue_id, array['OWNER']));
end;
$$;

-- Worker: the address and venue for an invitation email (nothing else).
create or replace function app.invitation_delivery(p_invitation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_worker() then
    perform app.fail('FORBIDDEN');
  end if;
  return (select jsonb_build_object('email', i.email, 'status', i.status, 'venue_name', v.name, 'role', i.role)
          from public.venue_invitations i join public.venues v on v.id = i.venue_id where i.id = p_invitation_id);
end;
$$;

-- P03/P04 data for managers -----------------------------------------------------------------------------------------
create or replace function app.partner_venue_overview(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_venue_manager(p_venue_id);
  v_venue public.venues;
begin
  select * into v_venue from public.venues where id = p_venue_id;
  return jsonb_build_object(
    'venue', jsonb_build_object('id', v_venue.id, 'name', v_venue.name, 'slug', v_venue.slug, 'description', v_venue.description,
                                'address', v_venue.address, 'locality', v_venue.locality, 'category_code', v_venue.category_code,
                                'timezone', v_venue.timezone, 'status', v_venue.status, 'status_reason', v_venue.status_reason,
                                'version', v_venue.version, 'submitted_at', v_venue.submitted_at,
                                'lat', round(extensions.st_y(v_venue.location::extensions.geometry)::numeric, 5),
                                'lng', round(extensions.st_x(v_venue.location::extensions.geometry)::numeric, 5),
                                'is_synthetic', v_venue.is_synthetic, 'active_schedule_version', v_venue.active_schedule_version),
    'role', (select role from public.venue_memberships m join public.profiles p on p.id = m.user_id
             where m.venue_id = p_venue_id and p.id = v_actor and m.status = 'ACTIVE'),
    'active_policy', (select app.policy_snapshot(p) from public.venue_policies p where p.id = v_venue.active_policy_id),
    'draft_policy', (select to_jsonb(p) - 'content_hash' from public.venue_policies p
                     where p.venue_id = p_venue_id and p.status = 'DRAFT' order by p.policy_version desc limit 1),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'label', r.label, 'capacity', r.capacity, 'status', r.status, 'operational_state', r.operational_state,
               'pause_reason', r.pause_reason, 'version', r.version,
               'current_rate', (select jsonb_build_object('hourly_paise', rr.hourly_paise, 'rate_version', rr.rate_version,
                                                          'effective_from', rr.effective_from)
                                from public.resource_rates rr where rr.resource_id = r.id and rr.effective_from <= now()
                                  and (rr.effective_to is null or rr.effective_to > now())),
               'next_rate', (select jsonb_build_object('hourly_paise', rr.hourly_paise, 'rate_version', rr.rate_version,
                                                       'effective_from', rr.effective_from)
                             from public.resource_rates rr where rr.resource_id = r.id and rr.effective_from > now()))
             order by r.label)
      from public.resources r where r.venue_id = p_venue_id and r.status <> 'RETIRED'), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', o.weekday, 'opens_local', to_char(o.opens_local, 'HH24:MI'),
                                          'closes_local', to_char(o.closes_local, 'HH24:MI'), 'closes_next_day', o.closes_next_day)
             order by o.weekday, o.opens_local)
      from public.opening_periods o where o.venue_id = p_venue_id and o.schedule_version = v_venue.active_schedule_version), '[]'::jsonb),
    'closures', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'resource_id', c.resource_id, 'resource_label', r.label,
                                          'starts_at', lower(c.blocked_range), 'ends_at', upper(c.blocked_range), 'reason', c.reason)
             order by lower(c.blocked_range))
      from public.inventory_claims c join public.resources r on r.id = c.resource_id
      where c.venue_id = p_venue_id and c.kind = 'CLOSURE' and c.active and upper(c.blocked_range) > now()), '[]'::jsonb),
    'media', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'alt_text', m.alt_text, 'status', m.status, 'sort_order', m.sort_order)
             order by m.sort_order)
      from public.venue_media m where m.venue_id = p_venue_id and m.status in ('PENDING', 'APPROVED', 'REJECTED')), '[]'::jsonb),
    'amenities', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'details', a.details, 'verified', a.verified_at is not null)
                                            order by a.code)
                           from public.venue_amenities a where a.venue_id = p_venue_id), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('group', t.tag_group, 'code', t.tag_code) order by t.tag_group, t.tag_code)
                      from public.venue_tags t where t.venue_id = p_venue_id), '[]'::jsonb),
    'publication_gaps', app.venue_publication_gaps(p_venue_id));
end;
$$;

-- P05 calendar for assigned staff: minimal booking data, closures and table readiness (no prices or customer IDs).
create or replace function app.partner_calendar(p_venue_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_venue_staff(p_venue_id);
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '14 days' then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'range'));
  end if;
  return jsonb_build_object(
    'resources', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'label', r.label, 'capacity', r.capacity, 'status', r.status,
                                                               'operational_state', r.operational_state, 'version', r.version)
                                            order by r.label)
                           from public.resources r where r.venue_id = p_venue_id and r.status <> 'RETIRED'), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object('booking_id', b.id, 'public_ref', b.public_ref, 'status', b.status,
                                          'hold_active', b.status in ('HOLD', 'PENDING_PAYMENT') and b.hold_expires_at > clock_timestamp(),
                                          'start_at', b.start_at, 'end_at', b.end_at, 'party_size', b.party_size,
                                          'resource_id', b.resource_id, 'version', b.version) order by b.start_at)
      from public.bookings b
      where b.venue_id = p_venue_id and b.start_at < p_to and b.end_at > p_from
        and b.status in ('HOLD', 'PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW')), '[]'::jsonb),
    'closures', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'resource_id', c.resource_id, 'starts_at', lower(c.blocked_range),
                                          'ends_at', upper(c.blocked_range), 'reason', c.reason) order by lower(c.blocked_range))
      from public.inventory_claims c
      where c.venue_id = p_venue_id and c.kind = 'CLOSURE' and c.active and c.blocked_range && tstzrange(p_from, p_to, '[)')), '[]'::jsonb),
    'can_manage', app.is_venue_member(p_venue_id, array['MANAGER', 'OWNER']),
    'server_now', clock_timestamp());
end;
$$;

-- P06: what venue staff may see about one booking. Managers also see the total for service-recovery decisions.
create or replace function app.partner_booking_detail(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_manager boolean;
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found or not app.is_venue_member(v_booking.venue_id) then
    perform app.fail('NOT_FOUND');
  end if;
  perform app.require_aal2();
  v_manager := app.is_venue_member(v_booking.venue_id, array['MANAGER', 'OWNER']);
  return jsonb_build_object(
    'booking_id', v_booking.id, 'venue_id', v_booking.venue_id, 'public_ref', v_booking.public_ref, 'status', v_booking.status,
    'start_at', v_booking.start_at, 'end_at', v_booking.end_at, 'party_size', v_booking.party_size,
    'resource_label', (select label from public.resources where id = v_booking.resource_id),
    'guest_name', (select p.display_name from public.profiles p where p.id = v_booking.customer_id),
    'checked_in_at', v_booking.checked_in_at, 'checked_out_at', v_booking.checked_out_at, 'cancelled_at', v_booking.cancelled_at,
    'version', v_booking.version, 'grace_minutes', (v_booking.policy_snapshot ->> 'grace_minutes')::integer,
    'total_paise', case when v_manager then v_booking.total_paise end,
    'can_manage', v_manager, 'server_now', clock_timestamp());
end;
$$;

-- No-show: assigned staff after the grace period, under the same locks and cutoff as check-in. The paid interval stays
-- allocated (no resale); the no-show refund follows the accepted policy (pilot default 0%).
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
  v_amount := app.div_half_up(v_attempt.amount_paise * coalesce((v_booking.policy_snapshot ->> 'no_show_refund_bps')::integer, 0), 10000);
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

-- A02 queue and detail --------------------------------------------------------------------------------------------
create or replace function app.admin_venue_queue(p_status text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_platform_admin();
begin
  if p_status not in ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'PAUSED', 'REJECTED') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'status'));
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('venue_id', v.id, 'name', v.name, 'locality', v.locality, 'status', v.status,
                                        'submitted_at', v.submitted_at, 'is_synthetic', v.is_synthetic,
                                        'pending_policy', exists (select 1 from public.venue_policies p
                                                                  where p.venue_id = v.id and p.status = 'DRAFT' and p.submitted_at is not null),
                                        'pending_media', (select count(*) from public.venue_media m where m.venue_id = v.id and m.status = 'PENDING'))
           order by v.submitted_at nulls last, v.name)
    from public.venues v
    where v.status = p_status
       or (p_status = 'PUBLISHED' and v.status = 'PUBLISHED' and exists (
             select 1 from public.venue_policies p where p.venue_id = v.id and p.status = 'DRAFT' and p.submitted_at is not null))), '[]'::jsonb);
end;
$$;

create or replace function app.admin_venue_detail(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_platform_admin();
  v_venue public.venues;
begin
  select * into v_venue from public.venues where id = p_venue_id;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  return jsonb_build_object(
    'venue', jsonb_build_object('id', v_venue.id, 'name', v_venue.name, 'description', v_venue.description, 'address', v_venue.address,
                                'locality', v_venue.locality, 'category_code', v_venue.category_code, 'status', v_venue.status,
                                'status_reason', v_venue.status_reason, 'submitted_at', v_venue.submitted_at, 'version', v_venue.version,
                                'is_synthetic', v_venue.is_synthetic,
                                'lat', round(extensions.st_y(v_venue.location::extensions.geometry)::numeric, 5),
                                'lng', round(extensions.st_x(v_venue.location::extensions.geometry)::numeric, 5)),
    'partner', (select jsonb_build_object('legal_name', p.legal_name, 'status', p.status) from public.partners p where p.id = v_venue.partner_id),
    'owners', coalesce((select jsonb_agg(regexp_replace(lower(u.email), '^(.).*(@.*)$', '\1***\2'))
                        from public.venue_memberships m join public.profiles pr on pr.id = m.user_id
                        join auth.users u on u.id = pr.auth_user_id
                        where m.venue_id = p_venue_id and m.role = 'OWNER' and m.status = 'ACTIVE'), '[]'::jsonb),
    'active_policy', (select app.policy_snapshot(p) from public.venue_policies p where p.id = v_venue.active_policy_id),
    'draft_policy', (select to_jsonb(p) - 'content_hash' from public.venue_policies p
                     where p.venue_id = p_venue_id and p.status = 'DRAFT' order by p.policy_version desc limit 1),
    'resources', coalesce((select jsonb_agg(jsonb_build_object('label', r.label, 'capacity', r.capacity, 'status', r.status,
                                                               'hourly_paise', (select rr.hourly_paise from public.resource_rates rr
                                                                                where rr.resource_id = r.id and rr.effective_to is null))
                                            order by r.label)
                           from public.resources r where r.venue_id = p_venue_id and r.status <> 'RETIRED'), '[]'::jsonb),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', o.weekday, 'opens_local', to_char(o.opens_local, 'HH24:MI'),
                                                           'closes_local', to_char(o.closes_local, 'HH24:MI')) order by o.weekday, o.opens_local)
                       from public.opening_periods o where o.venue_id = p_venue_id and o.schedule_version = v_venue.active_schedule_version), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'alt_text', m.alt_text, 'status', m.status) order by m.sort_order)
                       from public.venue_media m where m.venue_id = p_venue_id and m.status in ('PENDING', 'APPROVED', 'REJECTED')), '[]'::jsonb),
    'amenities', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'details', a.details)) from public.venue_amenities a
                           where a.venue_id = p_venue_id), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('group', t.tag_group, 'code', t.tag_code)) from public.venue_tags t
                      where t.venue_id = p_venue_id), '[]'::jsonb),
    'publication_gaps', app.venue_publication_gaps(p_venue_id),
    'history', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'reason', a.reason, 'at', a.created_at,
                                                             'actor_role', a.actor_role) order by a.created_at desc)
                         from (select * from public.audit_events where venue_id = p_venue_id
                               and action in ('partner.apply', 'venue.submit', 'venue.review', 'policy.submit', 'policy.review')
                               order by created_at desc limit 30) a), '[]'::jsonb));
end;
$$;

-- Media visibility for the API proxy: storage key when the caller may see it, else NOT_FOUND.
create or replace function app.media_object(p_media_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_media public.venue_media;
  v_public boolean;
begin
  select * into v_media from public.venue_media where id = p_media_id;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  v_public := v_media.status = 'APPROVED' and exists (select 1 from public.venues where id = v_media.venue_id and status = 'PUBLISHED');
  if not v_public and not (app.is_venue_member(v_media.venue_id) or app.has_platform_role(array['SUPPORT', 'SUPERADMIN'])) then
    perform app.fail('NOT_FOUND');
  end if;
  return jsonb_build_object('storage_key', v_media.storage_key, 'public', v_public);
end;
$$;

-- Storage: one private bucket; objects <venue_id>/<uuid>.<ext>. Insert by the venue's manager/owner with TOTP;
-- read when approved on a published venue, or by the venue's members and platform support. No client update/delete.
create or replace function app.media_object_readable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.venue_media m join public.venues v on v.id = m.venue_id
           where m.storage_key = p_name and m.status = 'APPROVED' and v.status = 'PUBLISHED')
         or app.is_venue_member(app.try_uuid(split_part(p_name, '/', 1)))
         or app.has_platform_role(array['SUPPORT', 'SUPERADMIN']);
$$;

create or replace function app.media_object_writable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
     and app.is_venue_member(app.try_uuid(split_part(p_name, '/', 1)), array['MANAGER', 'OWNER'])
     and app.current_aal() = 'aal2';
$$;

drop policy if exists venue_media_objects_insert on storage.objects;
create policy venue_media_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'venue-media' and app.media_object_writable(name));
drop policy if exists venue_media_objects_read on storage.objects;
create policy venue_media_objects_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'venue-media' and app.media_object_readable(name));

-- Public venue detail now lists approved photos (ids + alt text; images are served by the API proxy).
create or replace function app.venue_photos(p_venue_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'alt_text', m.alt_text) order by m.sort_order), '[]'::jsonb)
  from public.venue_media m join public.venues v on v.id = m.venue_id
  where m.venue_id = p_venue_id and m.status = 'APPROVED' and v.status = 'PUBLISHED';
$$;

-- The caller's own active venue memberships (venue id, name, slug, role) regardless of TOTP, so a new owner's draft
-- venue and the "verify it is you" step are reachable. Booking rows and prices stay TOTP-gated (M2 review R1).
create or replace function app.my_memberships()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('venue_id', v.id, 'venue_name', v.name, 'venue_slug', v.slug, 'role', m.role)
                            order by v.name), '[]'::jsonb)
  from public.venue_memberships m
  join public.profiles p on p.id = m.user_id
  join public.venues v on v.id = m.venue_id
  where p.auth_user_id = auth.uid() and p.status = 'ACTIVE' and m.status = 'ACTIVE';
$$;

grant execute on function
  app.partner_apply(text, text, text, text, text, double precision, double precision, uuid),
  app.partner_update_venue(uuid, jsonb, integer, uuid),
  app.partner_save_policy_draft(uuid, jsonb, uuid),
  app.partner_submit_policy(uuid, uuid, integer, uuid),
  app.partner_create_resource(uuid, text, integer, bigint, uuid),
  app.partner_update_resource(uuid, text, integer, integer, uuid),
  app.partner_set_rate(uuid, bigint, timestamptz, integer, uuid),
  app.partner_set_resource_status(uuid, text, text, integer, uuid),
  app.partner_set_hours(uuid, jsonb, integer, uuid),
  app.partner_set_amenities_tags(uuid, jsonb, jsonb, integer, uuid),
  app.partner_add_media(uuid, uuid, text, text, uuid),
  app.partner_remove_media(uuid, uuid),
  app.partner_submit_venue(uuid, integer, uuid),
  app.partner_release_closure(uuid, text, uuid),
  app.partner_invite(uuid, text, text, uuid),
  app.my_invitations(),
  app.accept_invitation(uuid, uuid),
  app.partner_revoke_member(uuid, integer, uuid),
  app.partner_revoke_invitation(uuid, uuid),
  app.partner_staff(uuid),
  app.partner_venue_overview(uuid),
  app.partner_calendar(uuid, timestamptz, timestamptz),
  app.partner_booking_detail(uuid),
  app.staff_mark_no_show(uuid, integer, uuid),
  app.admin_review_venue(uuid, text, text, integer, uuid),
  app.admin_review_policy(uuid, text, text, integer, uuid),
  app.admin_review_media(uuid, text, text, uuid),
  app.admin_venue_queue(text),
  app.admin_venue_detail(uuid),
  app.my_memberships()
  to authenticated;
grant execute on function app.media_object(uuid), app.venue_photos(uuid), app.media_object_readable(text) to anon, authenticated;
grant execute on function app.media_object_writable(text), app.try_uuid(text) to authenticated;
grant execute on function app.try_uuid(text) to anon;
grant execute on function app.invitation_delivery(uuid) to simply_worker;
-- Internal: require_venue_manager, require_platform_admin, audit, manager_role, future_commitments, lock_venue_inventory,
-- current_fee_config_version, validate_policy_fields, lock_partner_resource, venue_publication_gaps, my_auth_email.
revoke execute on all functions in schema app from public;
