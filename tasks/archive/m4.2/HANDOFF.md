# Handoff - M4.2 Extension

Date: 2 November 2026. Brief/plan: `BRIEF.md`, `PLAN.md`; review: `REVIEW.md` (self-review only). Earlier M4 slices:
`tasks/archive/m4.1/`, `tasks/archive/m4.3/`.

## Status

Done on web and the API; Android screens built (typecheck + bundle export), emulator run pending (planned once for all
M4 native screens):

- C11: a checked-in customer asks for more time (15-minute steps or the venue step, within the maximum duration and
  opening hours). Staff see the request on the arrivals desk with the answer deadline and approve/decline (TOTP).
  Approval checks the time still looks free but reserves nothing; the customer gets five minutes to "confirm
  availability and pay", which re-prices, widens the booking's own claim atomically (409 if the next booking or a
  blackout won) and holds it until min(hold + 5 min, original end). Payment uses a separate payment order bound to the
  extension; only an exact capture before the hold deadline moves the booking end (journal
  `allocation:extension:{id}`). A late capture becomes a full refund and the original booking stays; a second capture
  is refunded. Expiry (in the lock path and the worker sweep), withdrawal and check-out shrink the claim back.
- Customer notices: `extension.notify` (approved, declined, expired, applied) via the worker.
- Booking end changes are possible only through this path (booking guard).

## What changed

- `supabase/migrations/20261103000200_extensions.sql`: `extension_requests`, `payment_orders.extension_id` with one
  active order per booking and per extension, booking guard, extension expiry inside `expire_resource_holds` and the
  sweep, request/decide/hold/checkout/cancel/desk functions, extension branch in `apply_payment_observation`,
  extension-aware payment summary, reconciliation, check-out and customer projection.
- `packages/contracts` (extension schemas; booking `extension`/`extensions_applied`; payment status `extension_id`),
  `packages/db/src/extensions.ts`, `packages/payments` (`startExtensionCheckout`; verify settles extension orders only
  when APPLIED), `packages/api-client` (extension methods).
- `apps/web`: 6 routes, `/bookings/[id]/extend`, booking page link + receipt lines, staff desk requests panel, payment
  return outcomes for extensions. `apps/worker`: `extension.notify`. `apps/mobile`: `extend/[bookingId]`, booking
  button + receipt lines, payment-return outcomes.
- Tests: `tests/integration/extensions.test.ts` (9), `apps/web/e2e/extension.spec.ts` (1), worker unit test; e2e
  quick venues now open 04:00-03:55 by default (tests no longer fail late in the evening).

## Checks (2 Nov 2026)

| Command | Result |
| --- | --- |
| install, secrets, lint, typecheck, unit (65), db:reset (19 migrations) | PASS |
| `pnpm test:integration` | PASS - 14 files, 146 tests |
| `pnpm build`, `pnpm test:mobile`, `expo install --check` | PASS |
| `pnpm test:e2e` | 33/33 after the quick-venue hours change (the sequence's own e2e step failed 3 tests at 22:39 IST purely on time of day: quotes "soon" past the old 23:55 close) |

Evidence: `tasks/current/evidence/m4/web-m42-01..04-*.png` (requested, staff desk, approved, confirmed).

## Not verified / open

- Android emulator run of the extend screen (NOT RUN yet; planned with the other M4 native screens). iOS: NOT RUN.
- Reminder rescheduling after an extension: M4.6.
- Independent review of the payment-path change: NOT performed (REVIEW.md lists what to look at).
