# Handoff - M4.6 Notifications and analytics, and the M4 gate

Date: 3 November 2026. Brief/plan: `BRIEF.md`, `PLAN.md`; review: `REVIEW.md` (self-review only). Earlier M4 records:
`tasks/archive/m4.1`, `m4.3`, `m4.2`, `m4.5`, `m4.4`. MOCK providers throughout: no email is sent, no money moves.

## Status

Done on web, API and Android:

- In-app inbox (`/notifications` on web, Notifications from the Bookings tab on Android): newest first, unread count,
  opening one marks it read and goes to its booking, review or support request; "mark all as read". Email is the same
  event delivered by the worker (mock).
- End reminders: the worker reminds checked-in guests `end_reminder_minutes` before the committed end, once per end;
  an applied extension gets a fresh reminder. Ending a booking never depends on a reminder (tested both ways).
- New notices: refund complete / delayed, support reply / resolution (to the reporter), review published / hidden.
- Business metrics (`/admin/metrics`, A06): conversion, expiry, outcomes, occupancy, repeat customers, extension and
  refund reliability, check-in failures, reminders; money for finance roles only, collected money labelled "not
  revenue" and flagged unless a matched reconciliation covers the period. Aggregates only, definitions shown.
  Queue health moved to `/api/v1/admin/queue-metrics`.

## What changed

- `supabase/migrations/20261103000500_notifications_metrics.sql` (notify_user, end reminders, refund/ticket/review
  triggers, my_notifications, mark_notifications_read, admin_business_metrics).
- `packages/db/src/notifications.ts`; contracts (notification schemas + copy, metric definitions); api-client
  (list/mark read); worker tick sends reminders (failures logged, never fatal).
- Web: `GET /notifications`, `POST /notifications/{id}/read`, `POST /notifications/read-all`, `GET /admin/metrics`
  (business), `GET /admin/queue-metrics`; pages `/notifications` (+ nav link), `/admin/metrics` (+ admin link).
- Android: `app/notifications.tsx`, Bookings tab link; venue rating copy fix ("1 review").
- Tests: `tests/integration/notifications.test.ts` (5), `apps/web/e2e/notifications.spec.ts` (2).

## Checks (3 Nov 2026, 06:4x IST)

Full sequence: install, secrets, lint, typecheck, unit **70**, db:reset (22 migrations), integration **165/165**
(17 files), build, e2e **40/40**, test:mobile (Android + iOS export), expo install --check - all PASS. After the
Android copy fix: typecheck, lint, test:mobile re-run - PASS.

## Android emulator session (API 36 emulator, dev client, local stack, worker running)

Evidence `tasks/current/evidence/m4/android-09..21-*.png` (fictional native fixtures; mock gateway):
end reminder in the inbox (09); extension request, staff approval, Custom Tab mock payment, "Extension confirmed",
booking now ends 08:20 with the extra-time receipt line (10-13); inbox with reminder for the new end, extension and
confirmation notices (14); review from a notification: form, pending, published (15-16); Help with emergency number
and a support request (17); support reply notice and the reply on the request screen (18-19); venue page with the
private-bucket photo and rating (20); mark all read, 0 unread in the database (21).
Found: the venue rating said "1 reviews" (fixed); Metro started with `CI=1` does not watch files (restart it after edits).

## M4 gate (docs/06)

| Gate item | Result | Evidence |
| --- | --- | --- |
| Cancellation end to end | PASS | m4.1: integration, web e2e, Android 01-08 |
| Extension contention | PASS | m4.2: integration (contention, late/duplicate capture), web e2e; Android 10-13 |
| Partner closure | PASS | m4.3: integration (409 with references, no silent cancellation), web e2e |
| Incident access | PASS | m4.5: integration + e2e (confidential tickets: superadmin/assigned only) |
| Reconciled partner statement | PASS (mock provider) | m4.4: integration + e2e (matched run -> approved -> paid with evidence -> statement + CSV) |
| Staff "ready" before next arrival | PASS | M3 (unchanged; regression suite green) |
| Reminder never a condition of ending | PASS | m4.6 integration |

## M4 code review (3 Nov 2026, after the gate)

A `code-review` skill pass over the six M4 migrations found 10 issues; 7 real, 2 partly real, 1 not a defect. All
fixed in `supabase/migrations/20261103000600_m4_review_fixes.sql` with tests (refund caps after admin refunds, failed
refund retry without double charging, multi-run payout coverage per environment, terms frozen during venue review,
invitation fixes). Details: `tasks/archive/m4-review/REVIEW.md`. After the fixes: integration 168/168, unit 70,
e2e 40/40 (one intermittent partner closure test seen once), build, lint, typecheck, mobile, secrets - PASS.

## Not verified / open

- Independent human (or fresh-context) review of M4 money, permission and concurrency code is still required before
  release (CLAUDE.md); the skill pass above shared this session's context. Focus lists are in each slice's REVIEW.md.
- Owner decision: a second approver for large admin refunds.
- iOS NOT RUN (no Mac/EAS access). Real payment provider sandbox NOT available (D04), so reconciliation and refunds
  are proven against the mock only. Native push deferred. Owner decisions D02-D10 still open.
- M4.6 open items N1-N5 in REVIEW.md; accessibility pass (e.g. rating chips read as bare numbers) belongs to M5.
