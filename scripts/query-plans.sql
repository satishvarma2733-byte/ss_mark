-- Query-plan check at the TRD pilot scale (docs/02 s.7: 100 venues, 1,000 tables) plus 50,000 bookings, LOCAL ONLY.
-- Everything runs in one transaction that is ROLLED BACK: no data is left behind.
-- Usage (from build-kit/): docker exec -i supabase_db_build-kit psql -U postgres -q < scripts/query-plans.sql
\set ON_ERROR_STOP 1
\pset pager off
begin;

insert into public.partners (id, legal_name, display_name, status, is_synthetic)
values ('99999999-0000-4000-8000-000000000001', 'PLAN Partner (fictional)', 'PLAN Partner', 'APPROVED', true);

insert into public.venues (id, partner_id, category_code, name, slug, address, locality, location, is_synthetic)
select ('99999999-0001-4000-8000-' || lpad(v::text, 12, '0'))::uuid, '99999999-0000-4000-8000-000000000001', 'CAFE',
       'PLAN venue ' || v, 'plan-venue-' || v, 'Plan address', 'Plan locality',
       extensions.st_setsrid(extensions.st_makepoint(77.6, 12.9), 4326)::extensions.geography, true
from generate_series(1, 100) v;

insert into public.venue_policies (venue_id, policy_version, status, source_policy_version, byo_food, byo_details,
  outside_delivery, handover_instructions, house_rules, cancel_cutoff_minutes, early_refund_bps, late_refund_bps,
  no_show_refund_bps, minimum_minutes, increment_minutes, maximum_minutes, buffer_minutes, grace_minutes, lead_minutes,
  max_horizon_days, hold_minutes, quote_ttl_minutes, end_reminder_minutes, effective_from, accepted_terms_version)
select id, 1, 'PUBLISHED', 'proposed-2026-10-25', 'ALLOWED', 'Plan', 'ALLOWED', 'Plan', 'Plan', 120, 10000, 0, 0,
       60, 30, 240, 10, 15, 15, 30, 5, 5, 10, '2026-01-01T00:00:00Z', 'draft-terms-2026-10-26'
from public.venues where slug like 'plan-venue-%';

update public.venues v set active_policy_id = p.id, status = 'PUBLISHED', published_at = now()
from public.venue_policies p where p.venue_id = v.id and v.slug like 'plan-venue-%';

insert into public.resources (id, venue_id, label, capacity)
select ('99999999-0002-4000-8000-' || lpad((v * 100 + t)::text, 12, '0'))::uuid,
       ('99999999-0001-4000-8000-' || lpad(v::text, 12, '0'))::uuid, 'Plan table ' || t, 4
from generate_series(1, 100) v cross join generate_series(1, 10) t;

insert into public.profiles (id, status)
select ('99999999-0003-4000-8000-' || lpad(c::text, 12, '0'))::uuid, 'ACTIVE' from generate_series(1, 2000) c;

-- 50 non-overlapping bookings per table, 3 hours apart; ~2% are live holds.
create temporary table plan_rows on commit drop as
select gen_random_uuid() as quote_id, gen_random_uuid() as booking_id, r.id as resource_id, r.venue_id,
       ('99999999-0003-4000-8000-' || lpad((1 + (row_number() over () % 2000))::text, 12, '0'))::uuid as customer_id,
       timestamptz '2026-11-01 03:30:00Z' + (k * interval '3 hours') as start_at, k
from public.resources r cross join generate_series(0, 49) k
where r.label like 'Plan table %';

insert into public.quotes (id, customer_id, venue_id, resource_id, start_at, end_at, party_size, price_snapshot,
  policy_snapshot, policy_id, policy_hash, rate_version, total_paise, expires_at, status)
select q.quote_id, q.customer_id, q.venue_id, q.resource_id, q.start_at, q.start_at + interval '1 hour', 2,
       '{"schema":"price.v1"}', '{"schema":"policy.v1"}', v.active_policy_id, 'sha256:plan', 1, 30000,
       now() + interval '5 minutes', 'USED'
from plan_rows q join public.venues v on v.id = q.venue_id;

-- Confirmed bookings carry arrival-code hashes (constraint since M3); placeholder values, never real codes.
insert into public.bookings (id, customer_id, venue_id, resource_id, quote_id, start_at, end_at, party_size, status,
  hold_expires_at, price_snapshot, policy_snapshot, accepted_policy_hash, accepted_at, total_paise, checkin_token_hash,
  checkin_pin_hash)
select booking_id, customer_id, venue_id, resource_id, quote_id, start_at, start_at + interval '1 hour', 2,
       case when k % 50 = 0 then 'HOLD' else 'CONFIRMED' end,
       case when k % 50 = 0 then now() + interval '5 minutes' end,
       '{"schema":"price.v1"}', '{"schema":"policy.v1"}', 'sha256:plan', now(), 30000,
       case when k % 50 = 0 then null else 'plan-token-' || k end,
       case when k % 50 = 0 then null else 'plan-pin-' || k end
from plan_rows;

insert into public.inventory_claims (venue_id, resource_id, booking_id, kind, blocked_range, active, expires_at)
select venue_id, resource_id, booking_id, 'BOOKING',
       tstzrange(start_at, start_at + interval '70 minutes', '[)'), true,
       case when k % 50 = 0 then now() + interval '5 minutes' end
from plan_rows;

insert into public.outbox_jobs (business_key, kind, safe_payload, status, available_at)
select 'plan:' || g, 'diagnostic.sleep', '{}', case when g % 10 = 0 then 'READY' else 'DONE' end, now() - interval '1 minute'
from generate_series(1, 20000) g;

analyze public.bookings; analyze public.inventory_claims; analyze public.quotes; analyze public.outbox_jobs;
analyze public.venue_memberships; analyze public.profiles; analyze public.resources;

select (select count(*) from public.bookings) as bookings, (select count(*) from public.inventory_claims) as claims,
       (select count(*) from public.resources) as resources, (select count(*) from public.outbox_jobs) as jobs;

\echo '=== Q1 hold/quote overlap check (one table, one slot) ==='
explain (costs off) select 1 from public.inventory_claims c
 where c.resource_id = '99999999-0002-4000-8000-000000005005' and c.active
   and (c.expires_at is null or c.expires_at > now())
   and c.blocked_range && tstzrange('2026-11-02 10:00Z', '2026-11-02 11:10Z', '[)');

\echo '=== Q2 due-hold sweep ==='
explain (costs off) select distinct b.venue_id, b.resource_id from public.bookings b
 where b.status in ('HOLD', 'PENDING_PAYMENT') and b.hold_expires_at <= clock_timestamp() order by 1, 2 limit 200;

\echo '=== Q3 outbox lease candidates ==='
explain (costs off) select id from public.outbox_jobs
 where ((status = 'READY' and available_at <= clock_timestamp()) or (status = 'LEASED' and lease_until <= clock_timestamp() and attempts < max_attempts))
 order by available_at, id limit 10 for update skip locked;

\echo '=== Q4 customer reads own bookings through RLS ==='
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-000000000001","role":"authenticated"}', true);
explain (costs off) select id, status, start_at from public.bookings order by start_at desc limit 20;

\echo '=== Q5 venue staff reads venue calendar through RLS ==='
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-000000000003","role":"authenticated"}', true);
explain (costs off) select public_ref, status, start_at from public.bookings
 where venue_id = '22222222-2222-4222-8222-000000000001' order by start_at limit 200;

\echo '=== timing: customer own bookings via RLS (EXPLAIN ANALYZE) ==='
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-000000000001","role":"authenticated"}', true);
explain (analyze, costs off, timing off, summary on) select id from public.bookings order by start_at desc limit 20;
reset role;

\echo '=== Q6 worker sweeps every tick: earnings queue (M5) and due end reminders (M4.6) ==='
explain (costs off) select b.id from public.earning_queue q join public.bookings b on b.id = q.booking_id
 where (b.status <> 'NO_SHOW' or b.end_at <= now()) order by q.queued_at limit 100;
explain (costs off) select b.id from public.bookings b
 where b.status = 'CHECKED_IN' and b.end_at > now()
   and b.end_at - make_interval(mins => coalesce((b.policy_snapshot ->> 'end_reminder_minutes')::integer, 10)) <= now()
 order by b.end_at limit 100;

rollback;
