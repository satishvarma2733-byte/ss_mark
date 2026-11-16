-- M2.3 authorization: RLS on every table, explicit read grants, no client writes (docs/05 RLS matrix).
-- Writes happen only through the app.* SECURITY DEFINER functions, which re-check actor, membership and MFA.

do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('alter table public.%I force row level security', t.tablename);
  end loop;
end
$$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- Shared visibility predicate for catalogue rows of a venue.
create or replace function app.can_view_venue(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.venues v where v.id = p_venue_id and v.status = 'PUBLISHED')
      or app.is_venue_member(p_venue_id)
      or app.has_platform_role(array['SUPERADMIN', 'SUPPORT']);
$$;
grant execute on function app.can_view_venue(uuid) to anon, authenticated;

-- Catalogue: public projection of published venues; members and platform admins also see drafts. -------------------
grant select on public.venue_categories to anon, authenticated;
create policy venue_categories_read on public.venue_categories for select to anon, authenticated using (active);

grant select (id, partner_id, category_code, name, slug, description, address, locality, location, timezone, status,
              active_policy_id, active_schedule_version, published_at, is_synthetic, created_at, updated_at, version)
  on public.venues to anon, authenticated;
create policy venues_read on public.venues for select to anon, authenticated using (app.can_view_venue(id));

grant select on public.venue_policies to anon, authenticated;
create policy venue_policies_read on public.venue_policies for select to anon, authenticated using (
  (status = 'PUBLISHED' and app.can_view_venue(venue_id))
  or app.is_venue_member(venue_id, array['MANAGER', 'OWNER'])
  or app.has_platform_role(array['SUPERADMIN', 'SUPPORT'])
);

-- staff_note is operational and excluded from client reads.
grant select (id, venue_id, label, kind, capacity, status, operational_state, operational_since, created_at, updated_at, version)
  on public.resources to anon, authenticated;
create policy resources_read on public.resources for select to anon, authenticated using (
  (status <> 'RETIRED' and app.can_view_venue(venue_id)) or app.is_venue_member(venue_id)
);

grant select on public.resource_rates to anon, authenticated;
create policy resource_rates_read on public.resource_rates for select to anon, authenticated using (
  exists (select 1 from public.resources r where r.id = resource_id and app.can_view_venue(r.venue_id))
);

grant select on public.opening_periods, public.venue_amenities, public.venue_tags to anon, authenticated;
create policy opening_periods_read on public.opening_periods for select to anon, authenticated using (app.can_view_venue(venue_id));
create policy venue_amenities_read on public.venue_amenities for select to anon, authenticated using (app.can_view_venue(venue_id));
create policy venue_tags_read on public.venue_tags for select to anon, authenticated using (app.can_view_venue(venue_id));

grant select on public.venue_media to anon, authenticated;
create policy venue_media_read on public.venue_media for select to anon, authenticated using (
  (status = 'APPROVED' and app.can_view_venue(venue_id)) or app.is_venue_member(venue_id, array['MANAGER', 'OWNER'])
);

-- Partner identity: managers/owners of one of its venues and platform admins. provider_account_ref is never granted.
grant select (id, legal_name, display_name, status, payout_enabled, is_synthetic, created_at, updated_at, version)
  on public.partners to authenticated;
create policy partners_read on public.partners for select to authenticated using (
  exists (select 1 from public.venues v where v.partner_id = id and app.is_venue_member(v.id, array['MANAGER', 'OWNER']))
  or app.has_platform_role(array['SUPERADMIN', 'SUPPORT', 'FINANCE'])
);

grant select on public.fee_configurations to authenticated;
create policy fee_configurations_read on public.fee_configurations for select to authenticated using (
  app.has_platform_role(array['SUPERADMIN', 'FINANCE'])
);

-- Identity and roles ---------------------------------------------------------------------------------------------
grant select on public.profiles to authenticated;
create policy profiles_read_own on public.profiles for select to authenticated using (
  auth_user_id = auth.uid() or app.has_platform_role(array['SUPERADMIN', 'SUPPORT'])
);

grant select on public.venue_memberships to authenticated;
create policy venue_memberships_read on public.venue_memberships for select to authenticated using (
  user_id = app.my_profile_id()
  or app.is_venue_member(venue_id, array['MANAGER', 'OWNER'])
  or app.has_platform_role(array['SUPERADMIN'])
);

grant select on public.platform_memberships to authenticated;
create policy platform_memberships_read on public.platform_memberships for select to authenticated using (
  user_id = app.my_profile_id() or app.has_platform_role(array['SUPERADMIN'])
);

-- Bookings: own, or assigned venue members. checkin_token_hash is never granted. --------------------------------
grant select on public.quotes to authenticated;
create policy quotes_read_own on public.quotes for select to authenticated using (customer_id = app.my_profile_id());

grant select (id, public_ref, customer_id, venue_id, resource_id, quote_id, start_at, end_at, party_size, status,
              hold_expires_at, price_snapshot, policy_snapshot, accepted_policy_hash, accepted_at, total_paise, currency,
              cancel_reason, cancelled_at, expired_at, checked_in_at, checked_out_at, created_at, updated_at, version)
  on public.bookings to authenticated;
create policy bookings_read on public.bookings for select to authenticated using (
  customer_id = app.my_profile_id() or app.is_venue_member(venue_id)
);

grant select on public.inventory_claims to authenticated;
create policy inventory_claims_read on public.inventory_claims for select to authenticated using (
  app.is_venue_member(venue_id) or app.has_platform_role(array['SUPERADMIN'])
);

grant select on public.booking_events to authenticated;
create policy booking_events_read on public.booking_events for select to authenticated using (
  exists (
    select 1 from public.bookings b
    where b.id = booking_id and (b.customer_id = app.my_profile_id() or app.is_venue_member(b.venue_id))
  )
);

-- Own notifications and privacy requests; sanitized audit for venue managers and admins. -----------------------
grant select on public.notifications to authenticated;
create policy notifications_read_own on public.notifications for select to authenticated using (user_id = app.my_profile_id());

grant select on public.privacy_requests to authenticated;
create policy privacy_requests_read_own on public.privacy_requests for select to authenticated using (user_id = app.my_profile_id());

grant select on public.audit_events to authenticated;
create policy audit_events_read on public.audit_events for select to authenticated using (
  (venue_id is not null and app.is_venue_member(venue_id, array['MANAGER', 'OWNER']))
  or app.has_platform_role(array['SUPERADMIN'])
);

-- idempotency_records, outbox_jobs, worker_heartbeats and diagnostic_effects: RLS on, no policies, no client grants.

-- Functions get EXECUTE for PUBLIC by default, and a per-schema ALTER DEFAULT PRIVILEGES cannot revoke a global
-- default. Revoke explicitly; the role-specific grants above are unaffected. Every later migration that adds app.*
-- functions must repeat this (enforced by tests/integration/rls.test.ts).
revoke execute on all functions in schema app from public;

-- Storage: approved venue photos are public through the public bucket; there are no client upload policies in M2.
-- Privacy exports are private; a customer can read only objects under their own profile folder.
create policy privacy_exports_owner_read on storage.objects for select to authenticated using (
  bucket_id = 'privacy-exports' and (storage.foldername(name))[1] = app.my_profile_id()::text
);
