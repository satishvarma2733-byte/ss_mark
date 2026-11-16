# Current task brief - M4.1 Cancellation and refund of confirmed bookings

Objective: docs/06 M4.1 - "Preview accepted-policy refund; idempotent cancellation/refund intent; asynchronous
provider states; repeated admin/customer requests cannot over-refund; full venue-cancel liability" - on customer web,
Android (iOS NOT RUN) and the API, following docs/07 s.3 (`cancel-preview`, `cancel`), s.4 (`service-cancel`), s.5
(CONFIRMED -> CANCELLED), s.7 (refund states), docs/03 C10, docs/08 T09/T10.

State at start (2 Nov 2026): M3 closed out locally (records in `tasks/archive/m3/`): independent M3 review done and
fixed; Expo patch upgrade done. Still open from M3 and owner-blocked: real provider sandbox (D04), iOS, maps provider.

Rules (proposed policy, not owner-approved - D03): customer cancellation at least `cancel_cutoff_minutes` (120) before
the start refunds `early_refund_bps` (100%) of the captured booking payment, later refunds `late_refund_bps` (0%), always
from the booking's accepted policy snapshot; venue/service cancellation refunds 100%. CANCELLED is separate from
REFUNDED; a refund is PROCESSED only with provider evidence. Checked-in bookings are not customer-cancellable (support
remedy, M4.5).

Out of scope: extensions (M4.2), partner portal screens (M4.3 - the service-cancel API lands now, its partner UI with
the calendar), finance/admin refund queue and payouts (M4.4), support tickets (M4.5), reminders (M4.6), real provider.

Done when: preview and cancel work on web and Android; boundary, idempotency, over-refund, permission and race tests pass
on real PostgreSQL; refunds flow through the worker to PROCESSED with the mock provider; HANDOFF records results.
