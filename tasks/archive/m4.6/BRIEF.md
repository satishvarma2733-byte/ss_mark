# Current task brief - M4.6 Notifications and analytics

Objective: docs/06 M4.6 - "Durable in-app/email messages; confirmation/refund/reminder events deduplicated; metric
definitions instrumented without raw location/contact data. Native push is deferred pending provider, consent and
device-token design" (docs/01 PRD-11; docs/07 `GET /notifications`, `POST /notifications/{id}/read`, `GET /admin/metrics`).

Gate rule: reminder delivery is never a condition of a booking ending.

Scope:
- In-app notification inbox on web and Android (list, unread count, mark one/all read). Email is the same event,
  delivered by the worker through the mock email provider (MOCK: nothing is sent).
- End reminders `end_reminder_minutes` before the committed end of a checked-in booking, keyed by that end so an
  applied extension gets a fresh reminder and repeated sweeps never duplicate.
- New notices: refund processed / delayed, support reply / resolution (to whoever raised the ticket), review published
  / hidden (in-app only). Existing: confirmation, cancellation, no-show, refund requested, extension outcomes.
- Business metrics for admins (`/admin/metrics`): funnel, outcomes, occupancy, repeat customers, reliability and (finance
  roles only) collected / refunded / earned money with reconciliation state. Aggregates only, definitions published.
  Queue health moves to `/api/v1/admin/queue-metrics` (admin home unchanged).

Out of scope: native push, SMS/WhatsApp, marketing messages, notification preferences (transactional only).
