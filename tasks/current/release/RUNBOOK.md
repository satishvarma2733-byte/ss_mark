# Operations runbook (pilot)

Prepared 3 November 2026 for M6 from docs/06 (rollback and incident procedure) and docs/08 s.4, against the code as
built. Staffed hours, escalation contacts and alert recipients are owner decision D09; placeholders are marked TBD.

## 1. Launch sequence (one environment at a time: staging first, then production)

1. Owner approves the release package (`RELEASE-PACKAGE.md`) and the commit/build IDs being promoted.
2. Check, without displaying values: production secrets exist and differ from staging (`SECRETS-AND-CONFIG.md`); the
   mock gateway variables are absent; callback/webhook URL, Auth email sender, timezone and provider mode are correct.
3. Take a backup and confirm it can be restored (restore drill, s.6). Record the backup ID.
4. Apply migrations in order (`supabase db push` against the target project, owner-run). Migrations are additive; a
   new database starts with every release switch **closed**.
5. Deploy the worker, then the web/API build. Check `GET /api/v1/health` and `GET /api/v1/service-status`.
6. Smoke test with switches still closed: public browsing and venue pages (they say bookings are paused), sign-in,
   staff portal access without money actions, admin pages, `ops-checks.sql` all OK, one test alert delivered.
7. After operational approval (venues trained, support staffed): a superadmin opens BOOKINGS on `/admin/release`
   with a reason, then EXTENSIONS. PAYOUTS opens once the first daily reconciliation has matched.
8. Canary: a limited service area and the approved venues only; the first real bookings are watched end to end
   (payment, confirmation, arrival, check-out, earning, reconciliation) before wider promotion.

## 2. Release switches (`/admin/release`, superadmin; finance also for PAYOUTS)

| Switch | Closed means | Close it when |
| --- | --- | --- |
| BOOKINGS | No new quotes, holds or booking payment orders. Existing bookings, verification of payments already started, webhooks, cancellations, refunds, arrivals and reconciliation continue | Inventory conflict (overlap check above 0), uncertain payment state, provider outage, pricing or policy error, launch not yet approved |
| EXTENSIONS | No new extension requests, extension holds or extension payment orders; extensions already being paid still apply | Extension or payment fault, venue operations overloaded |
| PAYOUTS | Payout batches cannot be approved or moved to PROCESSING; recording a transfer already made as PAID still works | Reconciliation mismatch, suspected fraud, provider settlement problem |

Every change needs a reason (10-500 characters), TOTP and is audited (`release_switch.opened/closed`). The database
enforces the switches, so no API path, worker job or old app version can sell around them. A change applies to
requests that reach the check after it commits.

## 3. Incident procedure

1. Name an incident owner (TBD roster). Open an incident record with time, symptoms and request IDs (redacted).
2. Contain: close the relevant switch (s.2). Do not delete or edit transactions; do not reset any database.
3. Preserve evidence: ledger journals, audit events, booking events, provider event IDs.
4. Serve customers: support sees bookings and refunds in admin; venue cancellations refund in full automatically.
5. Reconcile against the provider (admin Finance > Reconciliation) before reopening anything.
6. Reopen with a reason; write a short review (cause, customers affected, money impact, follow-ups).

## 4. Rollback

- Web/API and worker: redeploy the previous build only if it is compatible with the current schema (every migration so
  far is additive, so the previous build remains compatible).
- Database: no down migrations. Fix forward; financial state is repaired from ledger and provider evidence.
- Native apps cannot be rolled back: keep the API compatible with the previous released app version, and use the
  switches for dangerous actions.

## 5. Forced app update (only with an approved recovery plan)

Set `NATIVE_MIN_VERSION` (for example `1.2.0`) on the web/API server and redeploy. Apps older than that cannot start
new bookings or extensions (HTTP 426 `UPDATE_REQUIRED`; the app shows an update notice) but keep bookings, receipts,
cancellation and support. Web is always current. Every app build sends its version (`x-simply-sit-client`).

## 6. Backup and restore

Local drill: `node scripts/restore-drill.mjs` restores into an isolated database and runs 28 checks (counts, constraints,
balanced ledger, links, RLS, functions, files). Hosted: point-in-time recovery or daily backups per the Supabase plan
(owner, D09 retention). **A restore cannot undo external charges**: after any restore, keep BOOKINGS closed, replay and
deduplicate provider events since the restore point (reconciliation run covering that period), and reopen only after a
matched run. Target from TRD: RPO 24 h, RTO 4 h; the local drill restored and verified in 13.5 s at local data size.

## 7. Daily operations

| When | Who | What |
| --- | --- | --- |
| Continuously (monitoring job) | Operations | `scripts/ops-checks.sql` (`pnpm ops:check` locally): CRITICAL rows page on-call, WARNING rows go to the operations channel |
| Daily | Finance | Reconciliation for the previous day (admin Finance); investigate every exception; failed refunds retried or resolved |
| Weekly or per settlement cycle (D04) | Two finance people | Draft payout per partner, a second person approves (blocked without a matched reconciliation), mark PAID only with the transfer reference |
| Daily during pilot | Operations | Venue cancellations, unready tables, support tickets and incidents; partner statements on request |

## 8. Alerts (from `scripts/ops-checks.sql`)

| Severity | Check | Threshold |
| --- | --- | --- |
| Critical | Overlapping active claims | > 0 |
| Critical | Captured money not allocated after 15 min | > 0 |
| Critical | Dead-letter jobs | > 0 |
| Critical | Workers seen in the last minute | < 1 |
| Warning | Oldest ready job | > 300 s |
| Warning | Holds past deadline for over 2 min | > 0 |
| Warning | Payment orders UNKNOWN over 15 min; payment attempts UNKNOWN | > 0 |
| Warning | Refunds open over 24 h; failed refunds not retried | > 0 |
| Warning | Tables cleaning over 30 min | > 0 |
| Warning | No matched reconciliation in 26 h; mismatched/failed run in 24 h | > 0 |
| Info | Venue cancellations in 24 h; closed switches | - |

Delivery (pager/email/chat), recipients and staffed hours: owner (D09). The checks need a read-only database role in
staging/production; local runs use the local superuser.
