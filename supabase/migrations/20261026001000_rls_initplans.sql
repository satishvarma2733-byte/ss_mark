-- M2 performance fix found by scripts/query-plans.sql at pilot scale (50,000 bookings): RLS policies that call
-- app.my_profile_id()/app.is_venue_member() per row forced a sequential scan (1.0 s for one customer's bookings).
-- The caller's identity is now resolved once per statement through scalar sub-selects (PostgreSQL InitPlans), so the
-- planner can use the customer/venue indexes. Access rules are unchanged; tests/integration/rls.test.ts re-verifies them.

-- Venues the caller has an ACTIVE membership in (ACTIVE profile only), optionally limited to roles.
create or replace function app.my_venue_ids(p_roles text[] default array['STAFF', 'MANAGER', 'OWNER'])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.venue_id), '{}'::uuid[])
  from public.venue_memberships m
  join public.profiles p on p.id = m.user_id
  where p.auth_user_id = auth.uid()
    and p.status = 'ACTIVE'
    and m.status = 'ACTIVE'
    and m.role = any (p_roles);
$$;

-- Venues whose catalogue rows the caller may read: published, assigned, or all for SUPERADMIN/SUPPORT
-- (same rule as app.can_view_venue, evaluated once).
create or replace function app.visible_venue_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select app.my_venue_ids() as mine, app.has_platform_role(array['SUPERADMIN', 'SUPPORT']) as admin
  )
  select coalesce(array_agg(v.id), '{}'::uuid[])
  from public.venues v, me
  where v.status = 'PUBLISHED' or v.id = any (me.mine) or me.admin;
$$;

grant execute on function app.my_venue_ids(text[]), app.visible_venue_ids() to anon, authenticated;

-- Catalogue ----------------------------------------------------------------------------------------------------
drop policy venues_read on public.venues;
create policy venues_read on public.venues for select to anon, authenticated
  using (id = any ((select app.visible_venue_ids())::uuid[]));

drop policy venue_policies_read on public.venue_policies;
create policy venue_policies_read on public.venue_policies for select to anon, authenticated using (
  (status = 'PUBLISHED' and venue_id = any ((select app.visible_venue_ids())::uuid[]))
  or venue_id = any ((select app.my_venue_ids(array['MANAGER', 'OWNER']))::uuid[])
  or (select app.has_platform_role(array['SUPERADMIN', 'SUPPORT']))
);

drop policy resources_read on public.resources;
create policy resources_read on public.resources for select to anon, authenticated using (
  (status <> 'RETIRED' and venue_id = any ((select app.visible_venue_ids())::uuid[]))
  or venue_id = any ((select app.my_venue_ids())::uuid[])
);

drop policy resource_rates_read on public.resource_rates;
create policy resource_rates_read on public.resource_rates for select to anon, authenticated using (
  resource_id in (select r.id from public.resources r where r.venue_id = any ((select app.visible_venue_ids())::uuid[]))
);

drop policy opening_periods_read on public.opening_periods;
create policy opening_periods_read on public.opening_periods for select to anon, authenticated
  using (venue_id = any ((select app.visible_venue_ids())::uuid[]));

drop policy venue_amenities_read on public.venue_amenities;
create policy venue_amenities_read on public.venue_amenities for select to anon, authenticated
  using (venue_id = any ((select app.visible_venue_ids())::uuid[]));

drop policy venue_tags_read on public.venue_tags;
create policy venue_tags_read on public.venue_tags for select to anon, authenticated
  using (venue_id = any ((select app.visible_venue_ids())::uuid[]));

drop policy venue_media_read on public.venue_media;
create policy venue_media_read on public.venue_media for select to anon, authenticated using (
  (status = 'APPROVED' and venue_id = any ((select app.visible_venue_ids())::uuid[]))
  or venue_id = any ((select app.my_venue_ids(array['MANAGER', 'OWNER']))::uuid[])
);

drop policy partners_read on public.partners;
create policy partners_read on public.partners for select to authenticated using (
  id in (select v.partner_id from public.venues v where v.id = any ((select app.my_venue_ids(array['MANAGER', 'OWNER']))::uuid[]))
  or (select app.has_platform_role(array['SUPERADMIN', 'SUPPORT', 'FINANCE']))
);

drop policy fee_configurations_read on public.fee_configurations;
create policy fee_configurations_read on public.fee_configurations for select to authenticated
  using ((select app.has_platform_role(array['SUPERADMIN', 'FINANCE'])));

-- Identity and roles ---------------------------------------------------------------------------------------------
drop policy profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles for select to authenticated using (
  auth_user_id = (select auth.uid()) or (select app.has_platform_role(array['SUPERADMIN', 'SUPPORT']))
);

drop policy venue_memberships_read on public.venue_memberships;
create policy venue_memberships_read on public.venue_memberships for select to authenticated using (
  user_id = (select app.my_profile_id())
  or venue_id = any ((select app.my_venue_ids(array['MANAGER', 'OWNER']))::uuid[])
  or (select app.has_platform_role(array['SUPERADMIN']))
);

drop policy platform_memberships_read on public.platform_memberships;
create policy platform_memberships_read on public.platform_memberships for select to authenticated using (
  user_id = (select app.my_profile_id()) or (select app.has_platform_role(array['SUPERADMIN']))
);

-- Bookings and operations ---------------------------------------------------------------------------------------
drop policy quotes_read_own on public.quotes;
create policy quotes_read_own on public.quotes for select to authenticated
  using (customer_id = (select app.my_profile_id()));

drop policy bookings_read on public.bookings;
create policy bookings_read on public.bookings for select to authenticated using (
  customer_id = (select app.my_profile_id()) or venue_id = any ((select app.my_venue_ids())::uuid[])
);

drop policy inventory_claims_read on public.inventory_claims;
create policy inventory_claims_read on public.inventory_claims for select to authenticated using (
  venue_id = any ((select app.my_venue_ids())::uuid[]) or (select app.has_platform_role(array['SUPERADMIN']))
);

drop policy booking_events_read on public.booking_events;
create policy booking_events_read on public.booking_events for select to authenticated using (
  booking_id in (
    select b.id from public.bookings b
    where b.customer_id = (select app.my_profile_id()) or b.venue_id = any ((select app.my_venue_ids())::uuid[])
  )
);

drop policy notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications for select to authenticated
  using (user_id = (select app.my_profile_id()));

drop policy privacy_requests_read_own on public.privacy_requests;
create policy privacy_requests_read_own on public.privacy_requests for select to authenticated
  using (user_id = (select app.my_profile_id()));

drop policy audit_events_read on public.audit_events;
create policy audit_events_read on public.audit_events for select to authenticated using (
  venue_id = any ((select app.my_venue_ids(array['MANAGER', 'OWNER']))::uuid[])
  or (select app.has_platform_role(array['SUPERADMIN']))
);

drop policy privacy_exports_owner_read on storage.objects;
create policy privacy_exports_owner_read on storage.objects for select to authenticated using (
  bucket_id = 'privacy-exports' and (storage.foldername(name))[1] = (select app.my_profile_id())::text
);

-- New functions receive PUBLIC EXECUTE by default; keep app.* closed (enforced by rls.test.ts).
revoke execute on all functions in schema app from public;
