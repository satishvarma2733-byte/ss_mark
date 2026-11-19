-- Venue logo (19 November 2026). A logo is a venue_media row of kind LOGO, so it reuses the photo pipeline end to end:
-- private `venue-media` bucket, server upload as the manager (TOTP), GET /api/v1/media/{id} proxy, app.media_object
-- visibility and app.admin_review_media moderation. Venues reference at most one APPROVED logo (the one shown) and at
-- most one PENDING replacement; the shown logo stays until a replacement is approved. Logos never count as photos
-- (photo limit, publication gap, public photo list).
--
-- No column on public.venues on purpose: venues.version is the partner editor's optimistic-concurrency token, and
-- moderating a logo must not invalidate a manager's open venue form (photos do not either).
--
-- Rollback: drop function app.partner_add_logo, app.venue_logo, app.venue_media_logo_replace (and its trigger); restore
-- app.venue_photos, app.partner_add_media, app.venue_publication_gaps, app.partner_venue_overview and
-- app.admin_venue_detail from 20261103000100; update venue_media set status = 'REMOVED' where kind = 'LOGO';
-- drop the two indexes and the kind column.

alter table public.venue_media add column kind text not null default 'PHOTO' check (kind in ('PHOTO', 'LOGO'));
create unique index venue_media_one_approved_logo on public.venue_media (venue_id) where kind = 'LOGO' and status = 'APPROVED';
create unique index venue_media_one_pending_logo on public.venue_media (venue_id) where kind = 'LOGO' and status = 'PENDING';

-- Approving a logo (one-off review or whole-venue approval) retires the previously shown logo first.
create or replace function app.venue_media_logo_replace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'LOGO' and new.status = 'APPROVED' and old.status <> 'APPROVED' then
    update public.venue_media set status = 'REMOVED'
    where venue_id = new.venue_id and kind = 'LOGO' and status = 'APPROVED' and id <> new.id;
  end if;
  return new;
end;
$$;
create trigger venue_media_logo_replace before update of status on public.venue_media
  for each row when (new.kind = 'LOGO') execute function app.venue_media_logo_replace();

-- Partner upload/replace: same rules as a photo (manager/owner with TOTP, key under the venue, alt text 3-250).
-- An earlier PENDING logo is withdrawn (REMOVED) so only the newest waits for review.
create or replace function app.partner_add_logo(
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
  update public.venue_media set status = 'REMOVED' where venue_id = p_venue_id and kind = 'LOGO' and status = 'PENDING';
  insert into public.venue_media (id, venue_id, storage_key, alt_text, sort_order, kind)
  values (p_media_id, p_venue_id, p_storage_key, trim(p_alt_text), 0, 'LOGO')
  returning * into v_media;
  perform app.audit(v_actor, app.manager_role(p_venue_id), 'logo.add', 'venue_media', v_media.id, p_venue_id, p_request_id, null);
  return jsonb_build_object('media_id', v_media.id, 'status', v_media.status, 'kind', v_media.kind);
end;
$$;

-- Public: the approved logo of a published venue ({id, alt_text}) or null.
create or replace function app.venue_logo(p_venue_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', m.id, 'alt_text', m.alt_text)
  from public.venue_media m join public.venues v on v.id = m.venue_id
  where m.venue_id = p_venue_id and m.kind = 'LOGO' and m.status = 'APPROVED' and v.status = 'PUBLISHED';
$$;

-- Photos only from here on.
create or replace function app.venue_photos(p_venue_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'alt_text', m.alt_text) order by m.sort_order), '[]'::jsonb)
  from public.venue_media m join public.venues v on v.id = m.venue_id
  where m.venue_id = p_venue_id and m.kind = 'PHOTO' and m.status = 'APPROVED' and v.status = 'PUBLISHED';
$$;

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
  if (select count(*) from public.venue_media
      where venue_id = p_venue_id and kind = 'PHOTO' and status in ('PENDING', 'APPROVED')) >= 12 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'media', 'reason', 'too_many'));
  end if;
  insert into public.venue_media (id, venue_id, storage_key, alt_text, sort_order)
  values (p_media_id, p_venue_id, p_storage_key, trim(p_alt_text),
          coalesce((select max(sort_order) from public.venue_media where venue_id = p_venue_id and kind = 'PHOTO'), 0) + 1)
  returning * into v_media;
  perform app.audit(v_actor, app.manager_role(p_venue_id), 'media.add', 'venue_media', v_media.id, p_venue_id, p_request_id, null);
  return jsonb_build_object('media_id', v_media.id, 'status', v_media.status);
end;
$$;

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
      select 1 from public.venue_media m where m.venue_id = p_venue_id and m.kind = 'PHOTO' and m.status in ('PENDING', 'APPROVED'))
    union all
    select 'requirement_tag' where not exists (
      select 1 from public.venue_tags t where t.venue_id = p_venue_id and t.tag_group = 'REQUIREMENT')
  ) gaps;
$$;

grant execute on function app.partner_add_logo(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function app.venue_logo(uuid) to anon, authenticated;
-- Internal: venue_media_logo_replace (trigger).
revoke execute on all functions in schema app from public;

-- Partner overview and admin detail: media rows now carry their kind (copied from 20261103000100; only 'kind' added).

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
      select jsonb_agg(jsonb_build_object('id', m.id, 'alt_text', m.alt_text, 'status', m.status, 'kind', m.kind, 'sort_order', m.sort_order)
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
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'alt_text', m.alt_text, 'status', m.status, 'kind', m.kind) order by m.sort_order)
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
