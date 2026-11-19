-- SYNTHETIC MOCK DATA FOR DESIGN REVIEW - LOCAL DEVELOPMENT DATABASE ONLY.
-- The four venues shown in the Figma file ("Web · Discover and results"): fictional names, prices, tables and photos.
-- They are not real businesses. Photos are the design's illustrative images (supabase/mock-media), uploaded to the
-- local venue-media bucket by `pnpm db:mock-media`. Idempotent: every insert skips rows that already exist, so this
-- file can be applied to a running local database without a reset. Runs after seed.sql (supabase/config.toml).

-- Venues (DRAFT until their policy exists) -------------------------------------------------------------------------
insert into public.venues (id, partner_id, category_code, name, slug, description, address, locality, location, is_synthetic)
select v.id::uuid, v.partner_id::uuid, v.category, v.name, v.slug, v.description,
       'Mock address (fictional), ' || v.locality || ', Bengaluru', v.locality,
       extensions.st_setsrid(extensions.st_makepoint(v.lng, v.lat), 4326)::extensions.geography, true
from (values
  ('22222222-2222-4222-8222-000000000101', '11111111-1111-4111-8111-000000000001', 'CAFE', 'The Verandah House', 'the-verandah-house',
   'Mock venue from the design file: a plant-filled café with window and garden tables. Fictional.', 'Indiranagar', 77.6412, 12.9719),
  ('22222222-2222-4222-8222-000000000102', '11111111-1111-4111-8111-000000000002', 'LOUNGE', 'The Palm Room', 'the-palm-room',
   'Mock venue from the design file: an arched lounge with a quiet zone and step-free access. Fictional.', 'Domlur', 77.6387, 12.9609),
  ('22222222-2222-4222-8222-000000000103', '11111111-1111-4111-8111-000000000002', 'BREWERY', 'Copper Yard', 'copper-yard',
   'Mock venue from the design file: a brick-vaulted brewery with long tables and open-air seating. Fictional.', 'Indiranagar', 77.6449, 12.9752),
  ('22222222-2222-4222-8222-000000000104', '11111111-1111-4111-8111-000000000001', 'WORKSPACE', 'Chapter & Co.', 'chapter-and-co',
   'Mock venue from the design file: a library-style workspace with fast Wi-Fi and power at every desk. Fictional.', 'HAL 2nd Stage', 77.6474, 12.9681)
) as v (id, partner_id, category, name, slug, description, locality, lng, lat)
on conflict do nothing;

-- Policies: POLICY_PROPOSED_2026_10_25 values, as in seed.sql -------------------------------------------------------
insert into public.venue_policies (
  venue_id, policy_version, status, source_policy_version, byo_food, byo_details, outside_delivery, handover_instructions,
  house_rules, cancel_cutoff_minutes, early_refund_bps, late_refund_bps, no_show_refund_bps, minimum_minutes,
  increment_minutes, maximum_minutes, buffer_minutes, grace_minutes, lead_minutes, max_horizon_days, hold_minutes,
  quote_ttl_minutes, end_reminder_minutes, effective_from, accepted_terms_version
)
select p.venue_id::uuid, 1, 'PUBLISHED', 'proposed-2026-10-25', p.byo_food, p.byo_details, p.delivery,
       'Show your booking pass at the host stand (mock).', p.house_rules,
       120, 10000, 0, 0, 60, 30, 240, 10, 15, 15, 30, 5, 5, 10, '2026-01-01T00:00:00Z', 'draft-terms-2026-10-26'
from (values
  ('22222222-2222-4222-8222-000000000101', 'RESTRICTED', 'Packed snacks and drinks are fine; no hot meals. Ordering from the café is optional.',
   'NOT_ALLOWED', 'Laptops welcome at window tables. Mock house rules.'),
  ('22222222-2222-4222-8222-000000000102', 'NOT_ALLOWED', 'Outside food and delivery not permitted. Ordering from the lounge is optional.',
   'NOT_ALLOWED', 'Quiet zone after 18:00. Mock house rules.'),
  ('22222222-2222-4222-8222-000000000103', 'NOT_ALLOWED', 'Outside food and drink not permitted. Ordering from the brewery is optional.',
   'NOT_ALLOWED', 'Adults only after 21:00. Mock house rules.'),
  ('22222222-2222-4222-8222-000000000104', 'ALLOWED', 'Outside food allowed in the pantry area. Ordering is optional.',
   'ALLOWED', 'Calls in the phone booths, please. Mock house rules.')
) as p (venue_id, byo_food, byo_details, delivery, house_rules)
on conflict do nothing;

-- Tables and rates (hourly prices as shown in the design) -----------------------------------------------------------
insert into public.resources (id, venue_id, label, capacity)
select r.id::uuid, r.venue_id::uuid, r.label, r.capacity
from (values
  ('33333333-3333-4333-8333-000000001011', '22222222-2222-4222-8222-000000000101', 'Window W01', 2),
  ('33333333-3333-4333-8333-000000001012', '22222222-2222-4222-8222-000000000101', 'Window W02', 2),
  ('33333333-3333-4333-8333-000000001013', '22222222-2222-4222-8222-000000000101', 'Garden G01', 4),
  ('33333333-3333-4333-8333-000000001021', '22222222-2222-4222-8222-000000000102', 'Arch A01', 6),
  ('33333333-3333-4333-8333-000000001022', '22222222-2222-4222-8222-000000000102', 'Alcove A02', 2),
  ('33333333-3333-4333-8333-000000001031', '22222222-2222-4222-8222-000000000103', 'Long table L01', 4),
  ('33333333-3333-4333-8333-000000001032', '22222222-2222-4222-8222-000000000103', 'Long table L02', 4),
  ('33333333-3333-4333-8333-000000001033', '22222222-2222-4222-8222-000000000103', 'Courtyard C01', 4),
  ('33333333-3333-4333-8333-000000001034', '22222222-2222-4222-8222-000000000103', 'Courtyard C02', 2),
  ('33333333-3333-4333-8333-000000001041', '22222222-2222-4222-8222-000000000104', 'Desk D01', 2),
  ('33333333-3333-4333-8333-000000001042', '22222222-2222-4222-8222-000000000104', 'Desk D02', 1)
) as r (id, venue_id, label, capacity)
on conflict do nothing;

insert into public.resource_rates (resource_id, rate_version, hourly_paise, effective_from, fee_config_version)
select r.resource_id::uuid, 1, r.hourly_paise, '2026-01-01T00:00:00Z', 'SANDBOX-ZERO-2026-10'
from (values
  ('33333333-3333-4333-8333-000000001011', 20000), ('33333333-3333-4333-8333-000000001012', 20000),
  ('33333333-3333-4333-8333-000000001013', 24000), ('33333333-3333-4333-8333-000000001021', 36000),
  ('33333333-3333-4333-8333-000000001022', 30000), ('33333333-3333-4333-8333-000000001031', 25000),
  ('33333333-3333-4333-8333-000000001032', 25000), ('33333333-3333-4333-8333-000000001033', 28000),
  ('33333333-3333-4333-8333-000000001034', 25000), ('33333333-3333-4333-8333-000000001041', 15000),
  ('33333333-3333-4333-8333-000000001042', 15000)
) as r (resource_id, hourly_paise)
on conflict do nothing;

-- Weekly hours (venue-local). weekday 0 = Sunday. -------------------------------------------------------------------
insert into public.opening_periods (venue_id, weekday, opens_local, closes_local, closes_next_day, schedule_version)
select h.venue_id::uuid, d.weekday, h.opens::time, h.closes::time, h.closes::time <= h.opens::time, 1
from (values
  ('22222222-2222-4222-8222-000000000101', '08:00', '22:00', 0, 6),
  ('22222222-2222-4222-8222-000000000102', '10:00', '23:00', 0, 6),
  ('22222222-2222-4222-8222-000000000103', '12:00', '23:30', 0, 6),
  ('22222222-2222-4222-8222-000000000104', '08:00', '20:00', 1, 6)
) as h (venue_id, opens, closes, first_day, last_day)
cross join lateral generate_series(h.first_day, h.last_day) as d (weekday)
on conflict do nothing;

insert into public.venue_amenities (venue_id, code, details)
select a.venue_id::uuid, a.code, 'Mock amenity (fictional, unverified)'
from (values
  ('22222222-2222-4222-8222-000000000101', 'WIFI'), ('22222222-2222-4222-8222-000000000101', 'POWER_OUTLETS'),
  ('22222222-2222-4222-8222-000000000102', 'QUIET_ZONE'), ('22222222-2222-4222-8222-000000000102', 'ACCESSIBLE_ENTRANCE'),
  ('22222222-2222-4222-8222-000000000103', 'WIFI'), ('22222222-2222-4222-8222-000000000103', 'OUTDOOR_SEATING'),
  ('22222222-2222-4222-8222-000000000104', 'WIFI'), ('22222222-2222-4222-8222-000000000104', 'POWER_OUTLETS')
) as a (venue_id, code)
on conflict do nothing;

insert into public.venue_tags (venue_id, tag_group, tag_code)
select t.venue_id::uuid, t.tag_group, t.tag_code
from (values
  ('22222222-2222-4222-8222-000000000101', 'REQUIREMENT', 'WORK'), ('22222222-2222-4222-8222-000000000101', 'ENVIRONMENT', 'LIVELY'),
  ('22222222-2222-4222-8222-000000000102', 'REQUIREMENT', 'MEET'), ('22222222-2222-4222-8222-000000000102', 'ENVIRONMENT', 'QUIET'),
  ('22222222-2222-4222-8222-000000000103', 'REQUIREMENT', 'GATHER'), ('22222222-2222-4222-8222-000000000103', 'ENVIRONMENT', 'OUTDOOR'),
  ('22222222-2222-4222-8222-000000000104', 'REQUIREMENT', 'STUDY'), ('22222222-2222-4222-8222-000000000104', 'ENVIRONMENT', 'QUIET')
) as t (venue_id, tag_group, tag_code)
on conflict do nothing;

-- Approved photos. The files are uploaded separately (pnpm db:mock-media); until then the page shows a placeholder.
insert into public.venue_media (id, venue_id, storage_key, alt_text, sort_order, status)
select m.id::uuid, m.venue_id::uuid, m.venue_id || '/' || m.id || '.jpg', m.alt_text, 0, 'APPROVED'
from (values
  ('44444444-4444-4444-8444-000000000101', '22222222-2222-4222-8222-000000000101', 'Sunlit café room with plants, wooden tables and window seating (illustrative).'),
  ('44444444-4444-4444-8444-000000000102', '22222222-2222-4222-8222-000000000102', 'Lounge with arched windows, sofas and a chandelier (illustrative).'),
  ('44444444-4444-4444-8444-000000000103', '22222222-2222-4222-8222-000000000103', 'Brick-vaulted brewery hall with long wooden tables (illustrative).'),
  ('44444444-4444-4444-8444-000000000104', '22222222-2222-4222-8222-000000000104', 'Library-style workspace with desks beside tall windows (illustrative).')
) as m (id, venue_id, alt_text)
on conflict do nothing;

-- Publish the mock venues with their policy (only those not yet published).
update public.venues v
   set active_policy_id = p.id, status = 'PUBLISHED', published_at = now()
  from public.venue_policies p
 where p.venue_id = v.id and p.status = 'PUBLISHED' and v.active_policy_id is null
   and v.id in ('22222222-2222-4222-8222-000000000101', '22222222-2222-4222-8222-000000000102',
                '22222222-2222-4222-8222-000000000103', '22222222-2222-4222-8222-000000000104');

-- Seating areas and published floor plans (seat-map phase 1). Copper Yard: indoor hall + open-air courtyard;
-- Chapter & Co.: one reading room. Layout rows are inserted as DRAFT, filled, then published (published ones are frozen,
-- so re-running skips the element inserts).
insert into public.venue_zones (id, venue_id, name, kind, floor_level, features, default_hourly_paise, sort_order)
select z.id::uuid, z.venue_id::uuid, z.name, z.kind, z.floor_level, z.features::text[], z.paise, z.sort_order
from (values
  ('55555555-5555-4555-8555-000000001031', '22222222-2222-4222-8222-000000000103', 'Brewery hall', 'INDOOR', 0, '{AIR_CONDITIONED}', 25000, 0),
  ('55555555-5555-4555-8555-000000001032', '22222222-2222-4222-8222-000000000103', 'Courtyard', 'OUTDOOR', 0, '{STEP_FREE}', 25000, 1),
  ('55555555-5555-4555-8555-000000001041', '22222222-2222-4222-8222-000000000104', 'Reading room', 'INDOOR', 0, '{QUIET,AIR_CONDITIONED}', 15000, 0)
) as z (id, venue_id, name, kind, floor_level, features, paise, sort_order)
on conflict do nothing;

update public.resources r set zone_id = t.zone_id::uuid, shape = t.shape, features = t.features::text[]
from (values
  ('33333333-3333-4333-8333-000000001031', '55555555-5555-4555-8555-000000001031', 'RECTANGLE', '{POWER_SOCKET}'),
  ('33333333-3333-4333-8333-000000001032', '55555555-5555-4555-8555-000000001031', 'RECTANGLE', '{}'),
  ('33333333-3333-4333-8333-000000001033', '55555555-5555-4555-8555-000000001032', 'ROUND', '{VIEW}'),
  ('33333333-3333-4333-8333-000000001034', '55555555-5555-4555-8555-000000001032', 'SQUARE', '{}'),
  ('33333333-3333-4333-8333-000000001041', '55555555-5555-4555-8555-000000001041', 'RECTANGLE', '{WINDOW,POWER_SOCKET,QUIET}'),
  ('33333333-3333-4333-8333-000000001042', '55555555-5555-4555-8555-000000001041', 'BAR_STOOL', '{POWER_SOCKET}')
) as t (id, zone_id, shape, features)
where r.id = t.id::uuid and r.zone_id is null;

insert into public.floor_layouts (id, zone_id, venue_id, layout_version, width, height)
select l.id::uuid, l.zone_id::uuid, l.venue_id::uuid, 1, l.width, l.height
from (values
  ('66666666-6666-4666-8666-000000001031', '55555555-5555-4555-8555-000000001031', '22222222-2222-4222-8222-000000000103', 600, 400),
  ('66666666-6666-4666-8666-000000001032', '55555555-5555-4555-8555-000000001032', '22222222-2222-4222-8222-000000000103', 500, 360),
  ('66666666-6666-4666-8666-000000001041', '55555555-5555-4555-8555-000000001041', '22222222-2222-4222-8222-000000000104', 500, 360)
) as l (id, zone_id, venue_id, width, height)
on conflict do nothing;

insert into public.layout_elements (layout_id, element_type, resource_id, label, x, y, width, height, rotation, sort_order)
select e.layout_id::uuid, e.element_type, e.resource_id::uuid, e.label, e.x, e.y, e.width, e.height, 0, e.sort_order
from (values
  ('66666666-6666-4666-8666-000000001031', 'TABLE', '33333333-3333-4333-8333-000000001031', null, 60, 80, 240, 80, 0),
  ('66666666-6666-4666-8666-000000001031', 'TABLE', '33333333-3333-4333-8333-000000001032', null, 60, 220, 240, 80, 1),
  ('66666666-6666-4666-8666-000000001031', 'COUNTER', null, 'Bar · order here', 380, 40, 180, 60, 2),
  ('66666666-6666-4666-8666-000000001031', 'DOOR', null, 'Entrance', 470, 360, 110, 30, 3),
  ('66666666-6666-4666-8666-000000001032', 'TABLE', '33333333-3333-4333-8333-000000001033', null, 80, 100, 110, 110, 0),
  ('66666666-6666-4666-8666-000000001032', 'TABLE', '33333333-3333-4333-8333-000000001034', null, 260, 110, 90, 90, 1),
  ('66666666-6666-4666-8666-000000001032', 'PLANT', null, null, 40, 280, 40, 40, 2),
  ('66666666-6666-4666-8666-000000001032', 'LABEL', null, 'Open air', 380, 300, 100, 30, 3),
  ('66666666-6666-4666-8666-000000001041', 'WINDOW', null, 'Windows', 0, 20, 10, 300, 0),
  ('66666666-6666-4666-8666-000000001041', 'TABLE', '33333333-3333-4333-8333-000000001041', null, 80, 80, 120, 70, 1),
  ('66666666-6666-4666-8666-000000001041', 'TABLE', '33333333-3333-4333-8333-000000001042', null, 300, 90, 50, 50, 2),
  ('66666666-6666-4666-8666-000000001041', 'COUNTER', null, 'Counter', 300, 280, 160, 60, 3)
) as e (layout_id, element_type, resource_id, label, x, y, width, height, sort_order)
where exists (select 1 from public.floor_layouts f where f.id = e.layout_id::uuid and f.status = 'DRAFT')
  and not exists (select 1 from public.layout_elements x where x.layout_id = e.layout_id::uuid and x.sort_order = e.sort_order);

update public.floor_layouts set status = 'PUBLISHED', published_at = now()
where id in ('66666666-6666-4666-8666-000000001031', '66666666-6666-4666-8666-000000001032', '66666666-6666-4666-8666-000000001041')
  and status = 'DRAFT';
