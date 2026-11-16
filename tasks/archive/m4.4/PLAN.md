# M4.4 plan: finance and admin

Written 3 November 2026. Earlier M4 records: `tasks/archive/m4.1`, `m4.3`, `m4.2`, `m4.5`.

## Database (`supabase/migrations/20261103000400_finance.sql`)

- Accounts PLATFORM_FEE_REVENUE, PLATFORM_ADJUSTMENT_EXPENSE; per-partner PARTNER_PAYABLE created on first posting
  (`post_journal` accepts `partner_id` on an entry). Journal kinds BOOKING_EARNED, ADMIN_REFUND_DUE, PAYOUT_PAID.
- `booking_earnings`, `payout_batches` (one open per partner; PAID needs evidence; approver differs from creator),
  `payout_allocations` (EARNING or negative ADJUSTMENT; an earning in at most one live allocation),
  `reconciliation_runs` + `reconciliation_exceptions`; `refunds.charge_to`, `refunds.admin_reason`;
  `fee_configurations.created_by`.
- Functions: `recognize_earnings` (worker), `admin_refund`, `admin_create_fee_config`, `admin_approve_fee_config`,
  `record_reconciliation`, `create_payout_batch`, `approve_payout_batch`, `mark_payout`, `admin_finance_overview`,
  `partner_statement`.

## Server and clients

- `packages/providers`: gateway `listCaptures/listRefunds(from, to)` (mock reads its own tables).
- `packages/payments`: `runReconciliation`. Worker tick recognises earnings.
- Routes: `/admin/refunds`, `/admin/fee-configurations`(+approve), `/admin/reconciliation`, `/admin/payout-batches`
  (+approve, +mark), `/admin/finance`, `/partner/reports` (+ CSV with formula-injection protection).
- Pages: `/admin/finance` (A05), admin refund on `/admin/bookings/[id]`, `/partner/reports` (P07).

## Tests

Integration `finance.test.ts`: earning split and balance; late cancellation earns the retained amount; admin refund
permissions, ceiling, charge to liability/partner/platform; refund after payout -> negative adjustment netted;
fee approval separation and immutability; reconciliation MATCHED, injected mismatch -> MISMATCH + exceptions +
payout approval blocked; payout lifecycle (separation of duties, evidence required, journals balanced); partner
statement scope. Unit: CSV escaping. Web e2e: finance page flow and partner report.
