-- M2 identity, tenant and catalogue tables (docs/05 "Catalogue, identity and ownership").

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  display_name text check (display_name is null or char_length(display_name) between 1 and 100),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'DELETION_PENDING', 'ANONYMIZED')),
  terms_version text,
  terms_accepted_at timestamptz,
  privacy_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint profiles_terms_pair check ((terms_version is null) = (terms_accepted_at is null))
);
comment on table public.profiles is 'Stable pseudonymous profile. Email/phone stay in auth.users and are never copied here.';
create index profiles_status_idx on public.profiles (status);
create trigger profiles_touch before update on public.profiles for each row execute function app.touch_row();

-- Every verified Auth user gets a minimal profile. Terms acceptance is recorded separately by app.accept_terms.
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (auth_user_id) values (new.id) on conflict (auth_user_id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function app.handle_new_auth_user();

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (char_length(legal_name) between 1 and 200),
  display_name text not null check (char_length(display_name) between 1 and 120),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'SUSPENDED')),
  provider_account_ref text unique,
  payout_enabled boolean not null default false,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
comment on column public.partners.provider_account_ref is 'Opaque payment-provider account reference. Never bank details. Not readable by venue staff.';
create trigger partners_touch before update on public.partners for each row execute function app.touch_row();

create table public.venue_categories (
  code text primary key check (code ~ '^[A-Z_]{2,30}$'),
  label text not null,
  active boolean not null default true
);
insert into public.venue_categories (code, label) values
  ('CAFE', 'Cafe'), ('HOTEL', 'Hotel'), ('RESTAURANT', 'Restaurant'),
  ('LOUNGE', 'Lounge'), ('BREWERY', 'Brewery'), ('WORKSPACE', 'Workspace');

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id),
  category_code text not null references public.venue_categories (code),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  description text not null default '' check (char_length(description) <= 3000),
  address text not null check (char_length(address) between 1 and 300),
  locality text not null check (char_length(locality) between 1 and 120),
  location extensions.geography (point, 4326) not null,
  timezone text not null default 'Asia/Kolkata',
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'PAUSED', 'REJECTED')),
  active_policy_id uuid,
  active_schedule_version integer not null default 1 check (active_schedule_version > 0),
  published_at timestamptz,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint venues_published_at check (status <> 'PUBLISHED' or published_at is not null)
);
comment on column public.venues.locality is 'Additive to docs/05: short area label for listings.';
comment on column public.venues.is_synthetic is 'Additive to docs/05: true for fictional fixtures so every surface can label them.';
create index venues_location_gix on public.venues using gist (location);
create index venues_status_partner_idx on public.venues (status, partner_id);
create index venues_partner_idx on public.venues (partner_id);
create trigger venues_touch before update on public.venues for each row execute function app.touch_row();

create or replace function app.validate_venue()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.is_valid_timezone(new.timezone) then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'timezone'));
  end if;
  return new;
end;
$$;
create trigger venues_validate before insert or update on public.venues for each row execute function app.validate_venue();

create table public.venue_memberships (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id),
  user_id uuid not null references public.profiles (id),
  role text not null check (role in ('STAFF', 'MANAGER', 'OWNER')),
  status text not null default 'INVITED' check (status in ('INVITED', 'ACTIVE', 'REVOKED')),
  invited_by uuid references public.profiles (id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (venue_id, user_id)
);
create index venue_memberships_user_status_idx on public.venue_memberships (user_id, status);
create trigger venue_memberships_touch before update on public.venue_memberships for each row execute function app.touch_row();

create table public.platform_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  role text not null check (role in ('SUPPORT', 'FINANCE', 'SUPERADMIN')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  granted_by uuid references public.profiles (id),
  reason text not null check (char_length(reason) between 3 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (user_id, role)
);
create index platform_memberships_user_idx on public.platform_memberships (user_id);
create trigger platform_memberships_touch before update on public.platform_memberships for each row execute function app.touch_row();

create table public.venue_media (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id),
  storage_key text not null unique,
  alt_text text not null check (char_length(alt_text) between 1 and 250),
  sort_order integer not null default 0,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
create index venue_media_venue_status_idx on public.venue_media (venue_id, status, sort_order);
create trigger venue_media_touch before update on public.venue_media for each row execute function app.touch_row();

create table public.venue_amenities (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id),
  code text not null check (code in (
    'WIFI', 'POWER_OUTLETS', 'AIR_CONDITIONING', 'RESTROOM', 'ACCESSIBLE_ENTRANCE',
    'ACCESSIBLE_RESTROOM', 'PARKING', 'OUTDOOR_SEATING', 'QUIET_ZONE'
  )),
  value boolean not null default true,
  details text check (details is null or char_length(details) <= 500),
  verified_at timestamptz,
  verified_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (venue_id, code)
);
create trigger venue_amenities_touch before update on public.venue_amenities for each row execute function app.touch_row();

create table public.venue_tags (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id),
  tag_group text not null check (tag_group in ('REQUIREMENT', 'ENVIRONMENT')),
  tag_code text not null,
  description text check (description is null or char_length(description) <= 300),
  created_at timestamptz not null default now(),
  constraint venue_tags_allowlist check (
    (tag_group = 'REQUIREMENT' and tag_code in ('WORK', 'MEET', 'WAIT', 'STUDY', 'GATHER', 'RELAX'))
    or (tag_group = 'ENVIRONMENT' and tag_code in ('QUIET', 'LIVELY', 'OUTDOOR', 'SEMI_PRIVATE'))
  ),
  unique (venue_id, tag_group, tag_code)
);
create index venue_tags_discovery_idx on public.venue_tags (tag_group, tag_code, venue_id);
