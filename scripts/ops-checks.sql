-- Operations health checks (docs/08 s.4 monitoring list). Read-only. One row per check: value, threshold and status
-- (OK / ALERT / INFO). Run by operations or a monitoring job with a read-only role; `pnpm ops:check` runs it locally.
-- CRITICAL rows page the on-call person; WARNING rows go to the operations channel; INFO is context.
-- Thresholds are proposals for the pilot (owner decision D09 sets support hours, escalation and alert recipients).
with checks(severity, check_name, value, threshold, note) as (
  select 'CRITICAL', 'overlapping_active_claims',
         (select count(*) from public.inventory_claims a join public.inventory_claims b
            on a.resource_id = b.resource_id and a.id < b.id and a.active and b.active and a.blocked_range && b.blocked_range),
         0, 'Must always be 0: the same table sold twice. Pause BOOKINGS and escalate.'
  union all
  select 'CRITICAL', 'captured_unallocated_over_15_min',
         (select count(*) from public.payment_attempts
           where state = 'CAPTURED' and allocation_state = 'UNALLOCATED' and captured_at < now() - interval '15 minutes'),
         0, 'Money captured but not tied to a booking, extension or refund. Run reconciliation; check the worker.'
  union all
  select 'CRITICAL', 'dead_letter_jobs',
         (select count(*) from public.outbox_jobs where status = 'DEAD'),
         0, 'Background jobs that exhausted retries. Inspect last_error_code and replay or resolve.'
  union all
  select 'CRITICAL', 'workers_seen_in_last_minute',
         (select count(*) from public.worker_heartbeats where last_seen_at > now() - interval '60 seconds'),
         1, 'Below 1 means no worker: holds do not expire, refunds and notifications stop.'
  union all
  select 'WARNING', 'oldest_ready_job_seconds',
         (select coalesce(extract(epoch from now() - min(available_at))::bigint, 0) from public.outbox_jobs
           where status = 'READY' and available_at <= now()),
         300, 'Queue is falling behind.'
  union all
  select 'WARNING', 'holds_past_deadline_over_2_min',
         (select count(*) from public.bookings where status = 'HOLD' and hold_expires_at < now() - interval '2 minutes'),
         0, 'Expired holds still blocking tables: the worker expiry sweep is not running.'
  union all
  select 'WARNING', 'payment_orders_unknown_over_15_min',
         (select count(*) from public.payment_orders where state = 'UNKNOWN' and updated_at < now() - interval '15 minutes'),
         0, 'Provider order creation outcome unknown; reconciliation must resolve it before retrying.'
  union all
  select 'WARNING', 'payment_attempts_unknown',
         (select count(*) from public.payment_attempts where state = 'UNKNOWN'),
         0, 'Payment outcome unknown at the provider.'
  union all
  select 'WARNING', 'refunds_open_over_24_h',
         (select count(*) from public.refunds where status in ('REQUESTED', 'PROCESSING', 'UNKNOWN') and created_at < now() - interval '24 hours'),
         0, 'Refunds not finished a day later; the customer is still waiting.'
  union all
  select 'WARNING', 'refunds_failed_not_retried',
         (select count(*) from public.refunds f where f.status = 'FAILED' and not exists (select 1 from public.refunds r where r.retry_of = f.id)),
         0, 'Finance must retry or resolve each failed refund (admin booking page).'
  union all
  select 'WARNING', 'tables_cleaning_over_30_min',
         (select count(*) from public.resources where operational_state = 'CLEANING' and operational_since < now() - interval '30 minutes'),
         0, 'Tables not marked ready; the next arrival may be blocked.'
  union all
  select 'WARNING', 'reconciliation_not_matched_in_26_h',
         (select count(*) from (select distinct provider, environment from public.payment_orders) p
           where not exists (select 1 from public.reconciliation_runs r
                              where r.provider = p.provider and r.environment = p.environment and r.status = 'MATCHED'
                                and r.completed_at > now() - interval '26 hours')),
         0, 'Daily provider reconciliation missing or not matched; payouts stay blocked.'
  union all
  select 'WARNING', 'reconciliation_mismatch_or_failed_24_h',
         (select count(*) from public.reconciliation_runs where status in ('MISMATCH', 'FAILED') and started_at > now() - interval '24 hours'),
         0, 'Investigate exceptions on the admin reconciliation page.'
  union all
  select 'INFO', 'venue_cancellations_24_h',
         (select count(*) from public.booking_events where event_type = 'CANCELLED' and reason_code like 'SERVICE:%'
            and created_at > now() - interval '24 hours'),
         null, 'Bookings cancelled by a venue or support (customer fully refunded).'
  union all
  select 'INFO', 'release_switches_closed',
         (select count(*) from public.release_switches where not is_open),
         null, (select coalesce('Closed: ' || string_agg(key, ', ' order by key), 'All open') from public.release_switches where not is_open)
)
select severity, check_name, value,
       case when threshold is null then 'INFO'
            when check_name = 'workers_seen_in_last_minute' then case when value >= threshold then 'OK' else 'ALERT' end
            when value > threshold then 'ALERT' else 'OK' end as status,
       threshold, note
from checks
order by case severity when 'CRITICAL' then 1 when 'WARNING' then 2 else 3 end, check_name;
