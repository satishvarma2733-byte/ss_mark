-- M2 identity helpers used by RLS policies and domain functions.
-- auth.uid() resolves a profile through profiles.auth_user_id; the stable profile ID is never assumed to be the Auth ID.
-- Memberships are re-read on every call, so revocation applies before the next statement (no stale JWT roles).

-- Profile for reads: still resolves while a deletion request is pending, so the customer can see open commitments.
create or replace function app.my_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p
  where p.auth_user_id = auth.uid() and p.status in ('ACTIVE', 'DELETION_PENDING');
$$;

-- Profile for writes: only ACTIVE accounts may change state.
create or replace function app.require_active_profile()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
begin
  if auth.uid() is null then
    perform app.fail('AUTH_REQUIRED');
  end if;
  select p.id, p.status into v_id, v_status from public.profiles p where p.auth_user_id = auth.uid();
  if v_id is null then
    perform app.fail('AUTH_REQUIRED');
  elsif v_status = 'SUSPENDED' then
    perform app.fail('ACCOUNT_SUSPENDED');
  elsif v_status <> 'ACTIVE' then
    perform app.fail('ACCOUNT_DELETION_PENDING');
  end if;
  return v_id;
end;
$$;

create or replace function app.is_venue_member(p_venue_id uuid, p_roles text[] default array['STAFF', 'MANAGER', 'OWNER'])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.venue_memberships m
    join public.profiles p on p.id = m.user_id
    where m.venue_id = p_venue_id
      and m.status = 'ACTIVE'
      and m.role = any (p_roles)
      and p.auth_user_id = auth.uid()
      and p.status = 'ACTIVE'
  );
$$;

create or replace function app.has_platform_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_memberships m
    join public.profiles p on p.id = m.user_id
    where m.status = 'ACTIVE'
      and m.role = any (p_roles)
      and p.auth_user_id = auth.uid()
      and p.status = 'ACTIVE'
  );
$$;

create or replace function app.current_aal()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1');
$$;

-- Portal-privileged writes require a TOTP-verified session (docs/06 M2.2 admin/staff MFA).
create or replace function app.require_aal2()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if app.current_aal() <> 'aal2' then
    perform app.fail('REAUTH_REQUIRED', jsonb_build_object('reason', 'mfa_required'));
  end if;
end;
$$;

grant execute on function
  app.my_profile_id(), app.is_venue_member(uuid, text[]), app.has_platform_role(text[]), app.current_aal()
  to anon, authenticated, simply_worker;
grant execute on function app.require_active_profile(), app.require_aal2() to authenticated;
