# M4.1 plan: cancellation and refund of confirmed bookings

Written 2 November 2026 before M4.1 edits. M3 records: `tasks/archive/m3/`.

## Design

- **One terms function.** `app.cancellation_terms(booking, now, kind)` returns `{refund_paise, retained_paise,
  captured_paise, minutes_before_start, window: EARLY|LATE|SERVICE, policy_version, terms_change_at}` from the booking's
  policy snapshot and its single BOOKING-allocated capture. Pure (takes `now`), so the exact cutoff boundary is tested
  deterministically. Refund = half-up(captured x bps / 10000).
- **Customer:** `app.cancel_preview(booking)` (no mutation; `preview_expires_at` = earlier of now+5 min and the moment the
  window changes) and `app.cancel_booking(booking, reason, expected_version, expected_refund_paise)`: owner only,
  CONFIRMED and before start, locks via `app.lock_booking`, recomputes at `db_now`; a different amount ->
  409 `CANCELLATION_CHANGED` with the new terms. Idempotency-Key required on the route.
- **Venue/service:** `app.service_cancel_booking(booking, reason_code, reason, expected_version)` by assigned
  MANAGER/OWNER or platform SUPPORT/SUPERADMIN, all with aal2; CONFIRMED and before the end; full refund; audited.
- **Effects in one transaction:** booking CANCELLED (codes cleared), claim released (table resellable), refund row
  (`CUSTOMER_CANCEL` / `SERVICE_CANCEL`, operation key `refund:booking:{id}:cancel`) when refund > 0, ledger journal
  `CANCELLATION_REFUND_DUE` (booking liability -> refund liability), booking event, outbox `refund.submit`,
  `booking.cancelled` (notification) and `refund.requested`. Existing worker submits and reconciles the refund.
- Later captures on a cancelled booking already become full refund liabilities (M3).

## Files

- `supabase/migrations/20261102000200_cancellation.sql` - constraints (refund reasons, journal kind, job kind), terms,
  preview, cancel, service cancel, grants.
- `packages/contracts` - cancel preview/request/result and service-cancel schemas, `CANCELLATION_CHANGED`.
- `packages/db` - wrappers. `packages/api-client` - preview/cancel.
- `apps/web` - `POST /bookings/{id}/cancel-preview`, `POST /bookings/{id}/cancel`, `POST /bookings/{id}/service-cancel`
  (partner/admin); page `/bookings/[id]/cancel` (C10) and a Cancel link on the booking page.
- `apps/worker` - `booking.cancelled` notification handler.
- `apps/mobile` - cancel screen from the booking detail.

## Tests

Integration (`tests/integration/cancellation.test.ts`): exact cutoff boundary (T09: before/at/after); early full
refund, late zero refund, claim released and table re-bookable; repeated cancel -> one refund; preview/terms changed ->
409; other customer NOT_FOUND; checked-in and past-start refused; service cancel full refund (manager aal2, aal1
refused, staff refused, outsider NOT_FOUND, support admin allowed); refund submitted -> PROCESSED; journals balanced;
cancel vs check-in race -> one outcome; refund ceiling with a duplicate capture.
Web e2e: book -> cancel preview -> confirm -> "Cancelled - refund pending". Android: cancel flow on the emulator.
Checks: lint, typecheck, unit, db:reset, integration, build, e2e, test:mobile, expo check.

## Rollback

New migration and additive routes/screens; deleting the migration and running `pnpm db:reset` returns to M3.
