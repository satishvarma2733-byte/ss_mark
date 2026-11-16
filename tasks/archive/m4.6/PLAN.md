# M4.6 plan: notifications and analytics

Written 3 November 2026. Earlier M4 records: `tasks/archive/m4.1`, `m4.3`, `m4.2`, `m4.5`, `m4.4`.

## Database (`supabase/migrations/20261103000500_notifications_metrics.sql`)

- `notify_user` (any user, booking optional, email optional); `job_notify_booking` delegates to it.
- `send_end_reminders` (worker): checked-in bookings inside their reminder window; event key includes the committed end.
- Triggers: refund PROCESSED/FAILED, support ticket reply/resolution, review moderation outcome.
- `my_notifications(offset, limit)`, `mark_notifications_read(id | all)`.
- `admin_business_metrics(from, to, venue)`: support/finance/superadmin + TOTP; finance block for finance roles only.

## Server and clients

- Contracts: notification schema + copy per template, metric definitions, metrics query.
- Routes: `GET /notifications`, `POST /notifications/{id}/read`, `POST /notifications/read-all`, `GET /admin/metrics`
  (business), `GET /admin/queue-metrics` (moved).
- Web: `/notifications` page + nav link; `/admin/metrics` page + admin link.
- Android: notifications screen (from the Bookings and Account tabs), mark read on open.
- Worker tick sends due end reminders.

## Tests

Integration `notifications.test.ts`: confirmation inbox + dedupe, ownership (other user NOT_FOUND), mark read
idempotent; end reminder once, fresh after an applied extension, none after check-out, check-out without a reminder;
refund/ticket/review notices; metrics permissions, finance block only for finance, no personal data. Web e2e:
inbox and metrics page.
