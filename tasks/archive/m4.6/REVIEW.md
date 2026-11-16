# Review checkpoint - M4.6 notifications and analytics

Independent review: **NOT performed** (self-review only).

| Area | Checked | Evidence |
| --- | --- | --- |
| Durable in-app | One row per (event, user, channel); redelivered jobs write nothing new; one email job per event (business key) | integration |
| Ownership | Only the owner lists or marks a notification (others NOT_FOUND); marking is idempotent and never touches delivery status | integration + e2e |
| End reminders | Checked-in bookings only, inside `end_reminder_minutes`, keyed by the committed end: once per end, again after an applied extension, none after check-out; check-out works with no reminder; a failed sweep is logged, never fatal | integration |
| New notices | Refund processed/delayed (trigger on provider outcome), support reply/resolution to the reporter, review published/hidden (in-app only) | integration |
| Metrics | Support/finance/superadmin + TOTP; staff/customers FORBIDDEN; bounded 92 days; unknown venue NOT_FOUND; money only for finance roles; collected money labelled not revenue and flagged unless reconciled; output carries no emails, IDs of people or coordinates | integration + e2e |

Open: N1 native push deferred (provider, consent, device tokens); N2 no notification preferences (transactional only);
N3 occupancy ignores closures and uses current opening hours for past days; N4 metrics are computed live (no
materialised history), fine at pilot scale; N5 queue health moved to `/api/v1/admin/queue-metrics` (no other caller).
