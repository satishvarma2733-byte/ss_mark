# Handoff - M4.4 Finance and admin

Date: 3 November 2026. Brief/plan: `BRIEF.md`, `PLAN.md`; review: `REVIEW.md` (self-review only).
Everything runs against the MOCK payment provider. No real money moves; payouts are recorded, never transferred. The
posting policy is a proposal pending finance review (D04/D05).

## Status

Done on web and API (finance and partner reports are web-only portals; native customer receipts gain the
"refund from Simply Sit support" reason text):

- Earnings: a worker sweep (and payout drafting) recognises finished paid bookings: completed, no-show after its end,
  cancelled with money retained. What is left in the booking's customer liability is split by the booking's own price
  snapshot into the partner's payable and platform fee revenue. Once per booking.
- Admin refunds (A03/A05): finance/superadmin + TOTP, reason, never above what the payment has left. Before the booking
  finishes the refund reduces what it will earn; afterwards finance charges it to the partner (netted from the next
  payout, the payable may go negative) or to Simply Sit. Audited; the customer sees it as requested, then refunded.
- Fee versions: future-dated drafts approved by a different finance person; approved versions are immutable.
- Reconciliation: provider captures and refunds for a period are compared, on the server, with local records and the
  ledger by provider ID. Exceptions: missing either side, amount or state differences, missing journals.
- Payouts: draft (earnings less adjustments, one open batch per partner), approval by a second person with a matched
  reconciliation covering the batch period and the payable re-checked under a partner lock, then processing, paid
  (evidence reference required, posts the payout journal), failed or cancelled (allocations released).
- P07 `/partner/reports`: venue-scoped statement for managers/owners with unresolved amounts flagged and a
  formula-safe CSV export.

## What changed

- `supabase/migrations/20261103000400_finance.sql` (tables booking_earnings, reconciliation_runs/exceptions,
  payout_batches/allocations; refunds.charge_to/admin_reason; fee_configurations.created_by; per-partner accounts in
  post_journal; functions listed in PLAN.md).
- `packages/db/src/finance.ts`; `packages/providers` gateway `listCaptures`/`listRefunds`; `packages/payments`
  `runReconciliation`; worker tick recognises earnings; `packages/domain/src/csv.ts` (+ unit test); contracts (finance
  schemas, `RECONCILIATION_REQUIRED`, `SEPARATION_OF_DUTIES`, refund reason text).
- Web API: `/admin/finance`, `/admin/refunds`, `/admin/bookings/{id}/refund-options`, `/admin/fee-configurations`
  (+approve), `/admin/reconciliation` (+`{id}`), `/admin/payout-batches` (+approve, +status),
  `/partner/venues/{id}/statement` (JSON/CSV).
- Web pages: `/admin/finance`, `/admin/finance/reconciliation/[id]`, refund form on `/admin/bookings/[id]`,
  `/partner/reports` (Reports tab); admin home opens to finance users; signed money formatter for balances.
- Tests: `tests/integration/finance.test.ts` (9), `packages/domain/src/csv.test.ts` (5), `apps/web/e2e/finance.spec.ts`
  (2). Test helpers: venue fee configuration and late refund overrides; `completedBooking` moved to e2e helpers.

## Checks (3 Nov 2026, 06:2x-06:3x IST)

Full sequence (`scratchpad/final-checks.sh`): install, secrets, lint, typecheck, unit, db:reset (21 migrations), build,
test:mobile, expo install --check - PASS. Integration and e2e failed in that run (see below), were fixed, and re-run:
integration **160/160** (16 files), unit **70/70**, build PASS, e2e **38/38**, lint and typecheck PASS.
Evidence: `tasks/current/evidence/m4/web-m44-01..03-*.png`.

## Found and fixed

- Reconciliation windows in both new tests reached back into the previous test file's deliberately unobserved captures
  and fabricated provider IDs; reconciliation correctly reported them, so the tests now reconcile only their own
  window. The finance form accepts seconds so an operator can do the same.
- Partner payables can be negative; the shared money formatter rejects negatives, so balances use a signed formatter.
- A refused admin refund rolls back its inline earning recognition (correct; the sweep earns it later).

## Not verified / open

- REVIEW.md F1-F5 (holdback, extension commission, tax, payout execution, failed partner-charged refunds).
- Independent review NOT performed. Real provider settlement reports NOT available (no provider account, D04).
