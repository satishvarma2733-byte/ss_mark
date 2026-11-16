# Current task brief - M4.4 Finance and admin

Objective: docs/06 M4.4 - "Permissioned refunds, fee versions, ledger/reconciliation, partner statement/export and payout
states; no payout marked paid without provider/bank evidence; negative adjustment handling" (docs/03 P07, A05;
docs/05 money tables and posting policy; docs/07 s.4 admin/finance, s.7 payouts; docs/08 T17, T18).

Proposed posting policy (finance review required before live money; D04/D05 owner decisions):
- Capture: GATEWAY_CLEARING -> CUSTOMER_BOOKING_LIABILITY (exists).
- Earned (booking COMPLETED, NO_SHOW after its end, or CANCELLED with money retained): what remains in the booking's
  customer liability moves to the partner's PARTNER_PAYABLE and PLATFORM_FEE_REVENUE using the booking's price
  snapshot commission (bps + fixed). No tax lines until a tax configuration is approved.
- Admin refund (finance + TOTP, reason): before earning it reduces the customer liability; after earning it is charged
  to the partner (PARTNER_PAYABLE, may go negative = adjustment netted from the next payout) or to the platform
  (PLATFORM_ADJUSTMENT_EXPENSE). Never above the captured amount (ceiling trigger).
- Payout: DRAFT from available payable (balance less reserved), approved by a second finance person after a MATCHED
  reconciliation covering the period, PAID only with an evidence reference (provider transfer / bank UTR); then
  PARTNER_PAYABLE -> GATEWAY_CLEARING. No live transfers: execution is recorded, not performed.
- Reconciliation compares provider captures/refunds for a period with the ledger by provider ID; any difference is a
  MISMATCH with exceptions and blocks payout approval.
- Fee versions: draft and approve by different finance people; future-dated; used by new rate versions only.

Out of scope: real provider settlement reports, disputes/chargebacks (no provider), tax.
