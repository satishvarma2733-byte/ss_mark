# Review checkpoint - M4.4 finance and admin

Independent review: **NOT performed** (self-review only). Money, permission and concurrency code: include in the M4
independent review before any live money (CLAUDE.md). The posting policy itself needs finance review (D04/D05).

| Area | Checked | Evidence |
| --- | --- | --- |
| Earnings | Finished paid bookings only (completed, cancelled with money retained, no-show after its end); amount = what is left in the booking's customer liability; split by the booking's own price snapshot; once per booking (unique row + journal business key; concurrent sweeps) | integration |
| Admin refunds | Finance/superadmin + TOTP; reason 10-500 chars; never above the attempt's refundable balance (existing ceiling trigger) or, before earning, the booking liability; after earning charged to partner or platform; audited; booking event; refund.submit job | integration + e2e |
| Fee versions | Future-dated; drafted and approved by different people (DB check + function); approved rows immutable; audited | integration + e2e |
| Reconciliation | Provider records fetched server-side (padded window), compared as worker role by provider ID: missing either side, amount, state, missing ledger journal; MISMATCH audited | integration + e2e |
| Payouts | One open batch per partner; allocations reserve each earning/adjustment once; approval by a second person, needs the latest run covering the batch period to be MATCHED, payable re-checked under the partner lock; PAID needs an evidence reference and posts PAYOUT_PAID; FAILED/CANCELLED release allocations; state machine trigger | integration + e2e |
| Negative adjustments | Partner-charged refund after payout makes the payable negative; next batch nets it; net <= 0 refuses (carried forward) | integration |
| Partner statement | Manager/owner + TOTP, venue-scoped (other venues NOT_FOUND, staff FORBIDDEN); bounded 92 days; unresolved flagged; CSV formula-safe | integration + unit + e2e |

Focus for the independent review:

- Lock order: admin refund takes venue -> resource -> booking, then the partner advisory lock; payout functions take only
  the partner lock; the earnings sweep uses `skip locked` booking row locks (never waits), recognised before the partner
  lock in `create_payout_batch`.
- `app.post_journal` now creates per-partner accounts on demand (`partner_account`, PARTNER_PAYABLE only).
- `create_payout_batch` uses a transaction-local temporary table inside a SECURITY DEFINER function.
- Reconciliation trusts provider lists passed by the server's worker-role call; `begin_reconciliation` is the only
  user-callable part.

Open: F1 payout holdback/reserve period and dispute reserves (owner decision D05); F2 extension money is earned with the
booking's commission (the extension snapshot's own fee is not used); F3 tax lines absent until a tax configuration is
approved; F4 no provider payout execution (recorded only); F5 refunds charged to a partner whose provider refund later
FAILS still count as an adjustment (the customer is still owed).
