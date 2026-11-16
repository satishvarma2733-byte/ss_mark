-- M2 independent review fixes (tasks/archive/m2/REVIEW.md R1, R2). Access rules tighten; nothing widens.

-- R1: venue-member reads now require a TOTP-verified (aal2) session, matching the portal pages. An email-code-only
-- session of a staff member no longer reads venue data through the REST gateway.
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
    and m.role = any (p_roles)
    and app.current_aal() = 'aal2';
$$;

-- R1: booking rows carry price snapshots (incl. commission) and the customer's profile ID. Customers read their own;
-- managers/owners read their venue's. Staff get the column-minimal arrival projection (app.staff_arrivals, M3).
drop policy bookings_read on public.bookings;
create policy bookings_read on public.bookings for select to authenticated using (
  customer_id = (select app.my_profile_id())
  or venue_id = any ((select app.my_venue_ids(array['MANAGER', 'OWNER']))::uuid[])
);

drop policy booking_events_read on public.booking_events;
create policy booking_events_read on public.booking_events for select to authenticated using (
  booking_id in (
    select b.id from public.bookings b
    where b.customer_id = (select app.my_profile_id())
       or b.venue_id = any ((select app.my_venue_ids(array['MANAGER', 'OWNER']))::uuid[])
  )
);

-- R2: holds require acceptance of the CURRENT terms version, not merely some version.
create or replace function app.require_current_terms(p_profile_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = p_profile_id and terms_version = app.current_terms_version()
  ) then
    perform app.fail('POLICY_NOT_ACCEPTED', jsonb_build_object('field', 'terms'));
  end if;
end;
$$;

revoke execute on all functions in schema app from public;
