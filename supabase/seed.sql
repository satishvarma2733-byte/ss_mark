-- SYNTHETIC DEMO FIXTURES ONLY - LOCAL DEVELOPMENT DATABASE.
-- Fictional venues, tables, prices, coordinates and @example.test accounts. No real businesses, people or credentials.
-- Fixed IDs are environment-specific test identifiers and never grant production privileges (docs/05 migration notes).
-- Policy values equal packages/domain POLICY_PROPOSED_2026_10_25 (asserted by tests/integration/consistency.test.ts).
-- Venues 1-3 equal packages/synthetic-data (asserted by the same test). Hourly rate = 2 x the 30-minute block price.

-- Release switches start closed in every database (M6); local development opens them for the synthetic fixtures.
update public.release_switches set is_open = true, reason = 'Local development seed: synthetic data only.';

-- Partners ---------------------------------------------------------------------------------------------------------
insert into public.partners (id, legal_name, display_name, status, is_synthetic) values
  ('11111111-1111-4111-8111-000000000001', 'DEMO Hospitality Partner One (fictional)', 'DEMO Partner One', 'APPROVED', true),
  ('11111111-1111-4111-8111-000000000002', 'DEMO Hospitality Partner Two (fictional)', 'DEMO Partner Two', 'APPROVED', true);

-- Sandbox fee configuration: zero commission/fees/tax, approved for SYNTHETIC use only (decision register D04 open).
insert into public.fee_configurations (config_version, status, commission_bps, platform_fixed_paise, customer_fee_paise,
                                       tax_rules, effective_from, approved_at, is_synthetic)
values ('SANDBOX-ZERO-2026-10', 'APPROVED', 0, 0, 0, '[]', '2026-01-01T00:00:00Z', now(), true);

-- Venues (created as DRAFT; published below once their policy exists) -------------------------------------------------
insert into public.venues (id, partner_id, category_code, name, slug, description, address, locality, location, is_synthetic)
select v.id::uuid, v.partner_id::uuid, v.category, v.name, v.slug, v.description,
       'Demo address (fictional), ' || v.locality, v.locality,
       extensions.st_setsrid(extensions.st_makepoint(v.lng, v.lat), 4326)::extensions.geography, true
from (values
  ('22222222-2222-4222-8222-000000000001', '11111111-1111-4111-8111-000000000001', 'CAFE', 'DEMO Cafe Koramangala', 'demo-cafe-koramangala',
   'Fictional cafe with two reservable tables.', 'Demo locality A (fictional)', 77.6245, 12.9352),
  ('22222222-2222-4222-8222-000000000002', '11111111-1111-4111-8111-000000000002', 'LOUNGE', 'DEMO Lounge Indiranagar', 'demo-lounge-indiranagar',
   'Fictional lounge with one large table.', 'Demo locality B (fictional)', 77.6408, 12.9784),
  ('22222222-2222-4222-8222-000000000003', '11111111-1111-4111-8111-000000000001', 'WORKSPACE', 'DEMO Workspace HSR', 'demo-workspace-hsr',
   'Fictional workspace, closed on Sundays.', 'Demo locality C (fictional)', 77.6387, 12.9116),
  ('22222222-2222-4222-8222-000000000004', '11111111-1111-4111-8111-000000000002', 'BREWERY', 'DEMO Brewery Koramangala', 'demo-brewery-koramangala',
   'Fictional brewery open past midnight.', 'Demo locality A (fictional)', 77.6229, 12.9339),
  ('22222222-2222-4222-8222-000000000005', '11111111-1111-4111-8111-000000000001', 'HOTEL', 'DEMO Hotel Lobby MG Road', 'demo-hotel-lobby-mg-road',
   'Fictional hotel lobby tables.', 'Demo locality D (fictional)', 77.6070, 12.9750),
  ('22222222-2222-4222-8222-000000000006', '11111111-1111-4111-8111-000000000002', 'RESTAURANT', 'DEMO Restaurant Jayanagar', 'demo-restaurant-jayanagar',
   'Fictional restaurant offering off-peak afternoon tables only.', 'Demo locality E (fictional)', 77.5838, 12.9250),
  ('22222222-2222-4222-8222-000000000007', '11111111-1111-4111-8111-000000000001', 'CAFE', 'DEMO Cafe BTM', 'demo-cafe-btm',
   'Fictional small cafe.', 'Demo locality F (fictional)', 77.6101, 12.9166),
  ('22222222-2222-4222-8222-000000000008', '11111111-1111-4111-8111-000000000002', 'WORKSPACE', 'DEMO Cowork Whitefield (draft)', 'demo-cowork-whitefield-draft',
   'Fictional unpublished listing used to prove drafts stay private.', 'Demo locality G (fictional)', 77.7499, 12.9698)
) as v (id, partner_id, category, name, slug, description, locality, lng, lat);

-- Policies: values from POLICY_PROPOSED_2026_10_25; food/delivery rules differ per venue ----------------------------
insert into public.venue_policies (
  venue_id, policy_version, status, source_policy_version, byo_food, byo_details, outside_delivery, handover_instructions,
  house_rules, cancel_cutoff_minutes, early_refund_bps, late_refund_bps, no_show_refund_bps, minimum_minutes,
  increment_minutes, maximum_minutes, buffer_minutes, grace_minutes, lead_minutes, max_horizon_days, hold_minutes,
  quote_ttl_minutes, end_reminder_minutes, effective_from, accepted_terms_version
)
select p.venue_id::uuid, 1, p.status, 'proposed-2026-10-25', p.byo_food, p.byo_details, p.delivery,
       'Show your booking reference at the counter (demo).', p.house_rules,
       120, 10000, 0, 0, 60, 30, 240, 10, 15, 15, 30, 5, 5, 10, '2026-01-01T00:00:00Z', 'draft-terms-2026-10-26'
from (values
  ('22222222-2222-4222-8222-000000000001', 'PUBLISHED', 'ALLOWED', 'Outside food allowed at this table. Ordering from the venue is optional.',
   'RESTRICTED', 'Keep noise moderate. Demo house rules.'),
  ('22222222-2222-4222-8222-000000000002', 'PUBLISHED', 'NOT_ALLOWED', 'Outside food and delivery not permitted. Ordering from the venue is optional.',
   'NOT_ALLOWED', 'Smart casual. Demo house rules.'),
  ('22222222-2222-4222-8222-000000000003', 'PUBLISHED', 'RESTRICTED', 'Cold outside food allowed; no hot food or deliveries to the table. Venue food is optional.',
   'NOT_ALLOWED', 'Quiet working area. Demo house rules.'),
  ('22222222-2222-4222-8222-000000000004', 'PUBLISHED', 'NOT_ALLOWED', 'Outside food and drink not permitted. Ordering from the venue is optional.',
   'NOT_ALLOWED', 'Adults only after 21:00. Demo house rules.'),
  ('22222222-2222-4222-8222-000000000005', 'PUBLISHED', 'RESTRICTED', 'Packaged snacks only. Ordering from the hotel is optional.',
   'RESTRICTED', 'Lobby dress code applies. Demo house rules.'),
  ('22222222-2222-4222-8222-000000000006', 'PUBLISHED', 'RESTRICTED', 'Baby food and medical dietary items only. Ordering from the restaurant is optional.',
   'NOT_ALLOWED', 'Off-peak seating; tables reset at 18:30. Demo house rules.'),
  ('22222222-2222-4222-8222-000000000007', 'PUBLISHED', 'ALLOWED', 'Outside food allowed. Ordering from the cafe is optional.',
   'ALLOWED', 'Small venue; parties up to two. Demo house rules.'),
  ('22222222-2222-4222-8222-000000000008', 'DRAFT', 'ALLOWED', 'Draft policy - not published.',
   'ALLOWED', 'Draft. Demo house rules.')
) as p (venue_id, status, byo_food, byo_details, delivery, house_rules);

-- Tables and rates -------------------------------------------------------------------------------------------------
insert into public.resources (id, venue_id, label, capacity)
select r.id::uuid, r.venue_id::uuid, r.label, r.capacity
from (values
  ('33333333-3333-4333-8333-000000000011', '22222222-2222-4222-8222-000000000001', 'Table 1 (demo)', 4),
  ('33333333-3333-4333-8333-000000000012', '22222222-2222-4222-8222-000000000001', 'Table 2 (demo)', 2),
  ('33333333-3333-4333-8333-000000000021', '22222222-2222-4222-8222-000000000002', 'Table 1 (demo)', 6),
  ('33333333-3333-4333-8333-000000000031', '22222222-2222-4222-8222-000000000003', 'Desk table 1 (demo)', 3),
  ('33333333-3333-4333-8333-000000000041', '22222222-2222-4222-8222-000000000004', 'Long table (demo)', 8),
  ('33333333-3333-4333-8333-000000000051', '22222222-2222-4222-8222-000000000005', 'Lobby table 1 (demo)', 4),
  ('33333333-3333-4333-8333-000000000052', '22222222-2222-4222-8222-000000000005', 'Lobby table 2 (demo)', 2),
  ('33333333-3333-4333-8333-000000000061', '22222222-2222-4222-8222-000000000006', 'Table 1 (demo)', 4),
  ('33333333-3333-4333-8333-000000000071', '22222222-2222-4222-8222-000000000007', 'Window table (demo)', 2),
  ('33333333-3333-4333-8333-000000000081', '22222222-2222-4222-8222-000000000008', 'Table 1 (demo)', 4)
) as r (id, venue_id, label, capacity);

insert into public.resource_rates (resource_id, rate_version, hourly_paise, effective_from, fee_config_version)
select r.resource_id::uuid, 1, r.hourly_paise, '2026-01-01T00:00:00Z', 'SANDBOX-ZERO-2026-10'
from (values
  ('33333333-3333-4333-8333-000000000011', 30000), ('33333333-3333-4333-8333-000000000012', 24000),
  ('33333333-3333-4333-8333-000000000021', 44000), ('33333333-3333-4333-8333-000000000031', 24000),
  ('33333333-3333-4333-8333-000000000041', 50000), ('33333333-3333-4333-8333-000000000051', 40000),
  ('33333333-3333-4333-8333-000000000052', 30000), ('33333333-3333-4333-8333-000000000061', 20000),
  ('33333333-3333-4333-8333-000000000071', 16000), ('33333333-3333-4333-8333-000000000081', 26000)
) as r (resource_id, hourly_paise);

-- Weekly hours (venue-local, Asia/Kolkata). weekday 0 = Sunday. ----------------------------------------------------
insert into public.opening_periods (venue_id, weekday, opens_local, closes_local, closes_next_day, schedule_version)
select h.venue_id::uuid, d.weekday, h.opens::time, h.closes::time, h.closes::time <= h.opens::time, 1
from (values
  ('22222222-2222-4222-8222-000000000001', '08:00', '22:00', 0, 6),
  ('22222222-2222-4222-8222-000000000002', '11:00', '23:00', 0, 6),
  ('22222222-2222-4222-8222-000000000003', '09:00', '20:00', 1, 6),
  ('22222222-2222-4222-8222-000000000004', '17:00', '01:00', 0, 6),
  ('22222222-2222-4222-8222-000000000005', '07:00', '23:00', 0, 6),
  ('22222222-2222-4222-8222-000000000006', '15:00', '18:30', 0, 6),
  ('22222222-2222-4222-8222-000000000007', '10:00', '21:00', 0, 6),
  ('22222222-2222-4222-8222-000000000008', '09:00', '18:00', 1, 5)
) as h (venue_id, opens, closes, first_day, last_day)
cross join lateral generate_series(h.first_day, h.last_day) as d (weekday);

insert into public.venue_amenities (venue_id, code, details)
select a.venue_id::uuid, a.code, 'Demo amenity (fictional, unverified)'
from (values
  ('22222222-2222-4222-8222-000000000001', 'WIFI'), ('22222222-2222-4222-8222-000000000001', 'POWER_OUTLETS'),
  ('22222222-2222-4222-8222-000000000002', 'AIR_CONDITIONING'), ('22222222-2222-4222-8222-000000000003', 'WIFI'),
  ('22222222-2222-4222-8222-000000000003', 'QUIET_ZONE'), ('22222222-2222-4222-8222-000000000004', 'OUTDOOR_SEATING'),
  ('22222222-2222-4222-8222-000000000005', 'RESTROOM'), ('22222222-2222-4222-8222-000000000007', 'WIFI')
) as a (venue_id, code);

insert into public.venue_tags (venue_id, tag_group, tag_code)
select t.venue_id::uuid, t.tag_group, t.tag_code
from (values
  ('22222222-2222-4222-8222-000000000001', 'REQUIREMENT', 'WORK'), ('22222222-2222-4222-8222-000000000001', 'ENVIRONMENT', 'LIVELY'),
  ('22222222-2222-4222-8222-000000000002', 'REQUIREMENT', 'MEET'), ('22222222-2222-4222-8222-000000000003', 'REQUIREMENT', 'STUDY'),
  ('22222222-2222-4222-8222-000000000003', 'ENVIRONMENT', 'QUIET'), ('22222222-2222-4222-8222-000000000004', 'REQUIREMENT', 'GATHER'),
  ('22222222-2222-4222-8222-000000000005', 'REQUIREMENT', 'WAIT'), ('22222222-2222-4222-8222-000000000006', 'REQUIREMENT', 'RELAX')
) as t (venue_id, tag_group, tag_code);

-- Publish venues 1-7 with their published policy. Venue 8 stays DRAFT.
update public.venues v
   set active_policy_id = p.id, status = 'PUBLISHED', published_at = now()
  from public.venue_policies p
 where p.venue_id = v.id and p.status = 'PUBLISHED';

-- Fixture accounts (OTP sign-in only: no passwords). Profiles are created by the auth.users trigger. --------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
                        email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email, '', now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
from (values
  ('44444444-4444-4444-8444-000000000001', 'customer.a@example.test'),
  ('44444444-4444-4444-8444-000000000002', 'customer.b@example.test'),
  ('44444444-4444-4444-8444-000000000003', 'staff.cafe@example.test'),
  ('44444444-4444-4444-8444-000000000004', 'manager.cafe@example.test'),
  ('44444444-4444-4444-8444-000000000005', 'staff.lounge@example.test'),
  ('44444444-4444-4444-8444-000000000006', 'admin@example.test')
) as u (id, email);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
from auth.users u
where u.email like '%@example.test';

update public.profiles p
   set terms_version = 'draft-terms-2026-10-26', terms_accepted_at = now(), privacy_version = 'draft-privacy-2026-10-26',
       display_name = initcap(split_part(split_part(u.email, '@', 1), '.', 1)) || ' (demo)'
  from auth.users u
 where u.id = p.auth_user_id and u.email like '%@example.test';

insert into public.venue_memberships (venue_id, user_id, role, status, accepted_at)
select m.venue_id::uuid, p.id, m.role, 'ACTIVE', now()
from (values
  ('22222222-2222-4222-8222-000000000001', '44444444-4444-4444-8444-000000000003', 'STAFF'),
  ('22222222-2222-4222-8222-000000000001', '44444444-4444-4444-8444-000000000004', 'MANAGER'),
  ('22222222-2222-4222-8222-000000000002', '44444444-4444-4444-8444-000000000005', 'STAFF')
) as m (venue_id, auth_user_id, role)
join public.profiles p on p.auth_user_id = m.auth_user_id::uuid;

-- Local-only bootstrap of one superadmin fixture. Production bootstrap uses scripts/bootstrap-admin.mjs, run by the owner.
insert into public.platform_memberships (user_id, role, status, reason)
select p.id, 'SUPERADMIN', 'ACTIVE', 'Local synthetic fixture (seed.sql)'
from public.profiles p where p.auth_user_id = '44444444-4444-4444-8444-000000000006';

-- LOCAL MOCK PAYMENT GATEWAY ------------------------------------------------------------------------------------------
-- State for packages/providers MockGateway (moves no money). Local development and tests only: it lives in this seed,
-- never in a migration, so no hosted database ever gets it. Not exposed by PostgREST; no client role has access.
create schema if not exists mock_gateway;
revoke all on schema mock_gateway from public, anon, authenticated;
create table mock_gateway.orders (
  id text primary key,
  amount_paise bigint not null check (amount_paise > 0),
  currency text not null,
  receipt text not null unique,
  status text not null default 'created' check (status in ('created', 'attempted', 'paid')),
  created_at timestamptz not null default now()
);
create table mock_gateway.payments (
  id text primary key,
  order_id text not null references mock_gateway.orders (id),
  amount_paise bigint not null check (amount_paise >= 0),
  currency text not null,
  status text not null check (status in ('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED')),
  captured_at timestamptz,
  created_at timestamptz not null default now()
);
create table mock_gateway.refunds (
  id text primary key,
  payment_id text not null references mock_gateway.payments (id),
  amount_paise bigint not null check (amount_paise > 0),
  idempotency_key text not null unique,
  status text not null default 'PROCESSED',
  created_at timestamptz not null default now()
);
create table mock_gateway.webhook_events (
  id text primary key,
  payment_id text,
  event_type text not null,
  body text not null,
  deliveries integer not null default 0,
  last_http_status integer,
  created_at timestamptz not null default now()
);
create table mock_gateway.settings (
  id integer primary key check (id = 1),
  faults jsonb not null default '{}'::jsonb
);
insert into mock_gateway.settings (id) values (1);
