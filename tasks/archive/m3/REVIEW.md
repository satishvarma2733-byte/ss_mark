# Current review checkpoint - M3 (discovery, quote, hold, payment, confirmation, arrival)

Reviewed revision: working tree on 2 November 2026 (no git repository/commits exist; see HANDOFF).
The M2 independent review (performed at the start of M3) and its fixes are in `tasks/archive/m2/REVIEW.md`.

## Independent review of M3 - performed 2 November 2026

Reviewer: a separate Claude agent (same model family) with no M3 authoring context, read-only (code, specs, catalog and
SELECT queries on the local database; no tests run). Not a human or different-vendor review: docs/06 M5.1 still calls
for human technical review of money/inventory code before live use. Result: **0 Critical, 0 High, 2 Medium, 7 Low,
8 Info.** Confirmed correct: grants (nothing in `app` executable by PUBLIC; the confirmation core granted to nobody),
column grants, lock order (except F3), confirmation rules, no duplicate allocation/refund/journal, webhook signature and
dedupe, verify ownership, order creation, arrival codes and checks, mock-gateway guards, mobile client.

| ID | Sev. | Finding | Resolution (migration `20261102000100_m3_review_fixes.sql` unless stated) |
| --- | --- | --- | --- |
| F1 | Medium | Paid orders reconciled with the provider every minute forever; every poll appended an observation row | **Fixed.** `app.orders_to_reconcile` selects only live holds (1 min), bookings confirmed <24 h (15 min), uncertain creations (30 s), expired orders with a provider order (10 min, 24 h); observations stored only when they differ from the last one. Tests: payments-recovery "reconciliation selection", "stores an observation only when it differs" |
| F2 | Medium | A refund whose submit job died (provider outage >~10 min) or stayed pending was never retried; FAILED left no trace | **Fixed.** `app.refunds_to_reconcile` + `reconcileRefunds` re-submit stalled refunds with the same operation key each worker tick; FAILED is audited (`refund.failed`); queue metrics report open/stalled/failed refunds and quarantined payments. Tests: outage then recovery, lost response (UNKNOWN) recovered with one provider refund and one journal, FAILED audited |
| F3 | Low | `record_refund_result` locked refund -> attempt -> booking, the reverse of `apply_payment_observation`: deadlock risk | **Fixed.** Locks the booking first via `app.lock_booking`. Test: refund result + two concurrent re-observations x4, no errors |
| F4 | Low | Provider/environment check compared the order with itself on verify/reconcile | **Fixed** (`packages/payments`): the gateway's own provider/environment are passed. Test: a LIVE gateway observing a TEST order -> MISMATCHED_ORDER |
| F5 | Low | Verify unthrottled and ungated (provider call + venue lock per call) | **Fixed.** Paid/finished bookings with nothing in flight skip the provider; per user+order limit 30/min (`apps/web/lib/rate-limit.ts`). Test: gated verify answers with the provider down |
| F6 | Low | Check-in failure limit exceedable by parallel requests | **Fixed.** Per-staff advisory lock in `app.staff_check_in`. Test: 14 parallel wrong codes -> exactly 10 INVALID + 4 RATE_LIMITED |
| F7 | Low | Anonymous availability (and quotes/bookings) exposed commission and internal fee fields | **Fixed** in the API (`apps/web/lib/price.ts`): availability, quote and booking detail return only customer-facing price fields. e2e test. The stored snapshot keeps them (spec); a customer can still read their own snapshot through the REST gateway - owner decision whether commission terms are confidential |
| F8 | Low | Webhook buffered the whole unauthenticated body before checking size | **Fixed** (`readBodyCapped`: Content-Length check, then a capped stream read). e2e test |
| F9 | Low | Copy promised "not charged twice"; an ended hold with a pending payment said "no payment was taken" and stopped polling | **Fixed** on web and native: a pending/authorized payment keeps the screen polling and says it will be refunded if taken; "a second payment is refunded in full" |
| F10 | Info | Checkout takes no Idempotency-Key | **Accepted, documented:** the one-active-order-per-booking unique index is the business key; repeated Pay returns the same order |
| F11 | Info | SUPERADMIN read the arrival log without MFA | **Fixed** (policy requires aal2). RLS test |
| F12 | Info | Later differing amount/currency observations dropped; MISMATCHED_ORDER evidence lost | **Fixed:** a changed amount/currency on unallocated money quarantines it and is stored as an observation; on allocated money it is audited; mismatched-order observations are audited. Tests |
| F13 | Info | Authorizations on expired/cancelled holds never voided | **Deferred:** provider-dependent (D04); late captures already become refunds |
| F14 | Info | In-flight payment marker survived sign-out | **Fixed** (mobile sign-out clears it) |
| F15 | Info | Mock gateway enablement fail-open (APP_ENV default, hostname check) | **Fixed:** requires `MOCK_GATEWAY_ENABLED=true` and an explicitly set development/test `APP_ENV` (written by `pnpm env:local`). Unit test |
| F16 | Info | Order-creation lease vs. a real provider's timeout; receipt lookup ignored currency | **Partly fixed:** currency now checked. Lease/timeout tuning recorded for the real adapter (gateway timeout must stay well below the 30 s lease) |
| F17 | Info | Reconciliation not leased across workers | **Fixed** with F1 (claim under FOR UPDATE SKIP LOCKED) |

Review coverage gaps addressed with tests: concurrent cancel-vs-capture (x5), strict cutoff (capture inside the hold,
observed after expiry), refund UNKNOWN/outage/FAILED, reconciliation selection, concurrent double check-in, parallel
rate limit, RLS on refunds/attempts/observations/provider events/arrival log, cross-origin cookie mutations (checkout,
cancel-hold, verify, check-in, check-out), oversized/malformed webhooks. Still not covered: worker crash mid provider
call for the M3 handlers (only the diagnostic job has a crash demo), order-creation lease takeover, grace-elapsed
check-in (needs a booking that started >15 min ago; snapshots and start times are immutable by design), exact
`db_now = hold_expires_at` instant.

## Review first (highest risk)

1. `supabase/migrations/20261026001300_checkout_functions.sql` - `app.apply_payment_observation`, the only confirmation
   path: lock order (venue -> resource -> booking via `app.lock_booking`, then order, then attempt); clock sampled after
   locks; due holds expired first; CONFIRMED only for an exact amount + currency + order + provider + environment
   capture while `db_now < hold_expires_at` and the claim is active; every other capture -> REFUND_DUE (late, cancelled,
   duplicate) or QUARANTINED (amount/currency mismatch); state rank prevents regression; `allocation:booking:{id}`
   journal key and the `payment_attempts_one_booking_allocation` index make a second allocation impossible.
2. Grants: `app.apply_payment_observation` is granted to nobody; `app.process_payment_observation` only to
   `simply_worker` and also checks `current_setting('role')`. The API reaches it with `asWorker` **after** fetching the
   payment from the gateway itself (`packages/payments`). Confirm no route passes client-supplied state into it.
3. `app.begin_checkout` / `app.claim_order_creation` / `packages/payments ensureProviderOrder` - one active order per
   booking (partial unique index), creation lease, reconcile-by-receipt before create, UNKNOWN on timeout.
4. `supabase/migrations/20261026001200_payments_ledger.sql` - immutability/regression guards on orders, attempts and
   refunds; `app.guard_refund` (refundable balance under the attempt lock); deferred balanced-journal trigger (runs as
   owner because deferred triggers fire under the caller's role at COMMIT).
5. `apps/web/app/api/v1/webhooks/mock/route.ts` - HMAC over the raw body before parsing; allowlisted fields only; 200
   only after durable insert; duplicates deduplicated by `(provider, environment, event_id)`.
6. `app.staff_check_in` (`20261026001400_discovery_arrival.sql`) - codes hashed in the database; generic INVALID for
   unknown/wrong-venue codes, logged so the per-staff rate limit holds across instances; window (start-15 min to start +
   grace), READY table, early-arrival overlap check, aal2.
7. `packages/domain/src/arrival.ts` - HMAC-derived QR token/PIN; only hashes stored; secret rotation invalidates codes.
8. Review fix R1 (`20261026001100_m2_review_fixes.sql`): `app.my_venue_ids` now requires aal2; booking/event rows are
   customer + MANAGER/OWNER only; staff reads go through `app.staff_arrivals` / `app.venue_bookings_calendar`.

## Known limits a reviewer should weigh

- **Mock provider only.** No Razorpay (or other) sandbox evidence exists: real payloads, signature scheme, native SDK,
  refund-idempotency header and order-by-receipt lookup are NOT RUN (decision D04). The adapter interface
  (`packages/providers/src/gateway.ts`) is shaped after Razorpay but unverified against it.
- The ledger posting (GATEWAY_CLEARING / CUSTOMER_BOOKING_LIABILITY / CUSTOMER_REFUND_LIABILITY / UNALLOCATED_SUSPENSE)
  is a proposed placeholder pending finance review; no commission, partner payable or tax postings exist.
- QUARANTINED (wrong amount/currency) money waits for an operator; the admin refund path is M4.
- Customer cancellation of a CONFIRMED booking and its policy refund are M4; only unpaid-hold release exists.
- Arrival-code secret rotation needs a re-issue procedure (M5).
- The `/payment/return` page polls `verify` (provider fetch) for 30 s, then status only; provider rate limits unknown.
- Search runs per-table slot checks in PL/pgSQL; measured only at seed scale (pilot-scale plans: M5 / TRD T21).
- The schematic map is a placeholder; no maps provider (owner account needed).

## Findings by the author during M3 (fixed, with regression tests)

- The balanced-journal trigger referenced `new.journal_id` inside a CASE evaluated against `ledger_journals` rows and
  failed; split into branches (`payments.test.ts` covers both tables).
- The same deferred trigger failed with "permission denied" because it fired at COMMIT as `simply_worker`; made
  SECURITY DEFINER.
- Review fix R1 silently emptied the M2 `/partner/bookings` calendar for staff; replaced the direct read with
  `app.venue_bookings_calendar` (minimal columns, aal2).
- The partner page assumed `Date` objects from the old query; fixed when the calendar returned ISO strings (e2e caught it).
- Android device run (2 Nov 2026): on a cold start the Expo **development client** routes the incoming
  `simplysit-dev://payment-return?...` intent to `DevLauncherActivity`, which loads the bundle and drops the path, so
  the app opened on Home after the provider redirect (`evidence/m3/android-10-defect-cold-start-lands-on-home.png`).
  The same link delivered to a running app routes correctly. Fixed in the app rather than relying on the redirect:
  `apps/mobile/lib/pending-payment.ts` remembers the in-flight payment order (ID only, secure store, 30-minute
  expiry) before opening the provider, `app/_layout.tsx` resumes to the payment status screen on launch, and the
  marker is cleared once the server reports a final state. Re-verified on the emulator (relaunch from the icon after a
  force-stop resumed to "Booking confirmed"). Release-build routing of the cold-start link is still NOT RUN.
- The status screen said "Verifying payment" (and after 30 s "do not pay again") when the provider had **no** payment
  for the order, e.g. the customer closed the tab. Now "No payment received yet" with Back to checkout, on web and
  native, while it keeps polling for a late payment.

## Observed during the device run (handled as designed)

- After `am kill` of the app process, Android closed the Custom Tab with it; a later scripted tap then landed on an
  earlier provider page that Chrome restored for an **already-paid** order and paid it a second time
  (SS-MGCSHA8BDB). Outcome: booking stayed CONFIRMED on the first capture; the second became a DUPLICATE_CAPTURE refund
  liability, the worker submitted it and the mock provider processed it; three balanced journals; one confirmation
  and one refund notification. Real providers may refuse a second payment on a paid order; the mock does not.
- Reconciliation pacing: the worker ran 1,601 order reconciliations in about an hour (mostly orders left by test runs,
  READY orders every minute, EXPIRED orders with a provider reference every 5 minutes for 24 h). Against a real
  provider this needs batching/backoff and rate-limit handling before sandbox use.
- Overlapping venues (same coordinates) draw overlapping pins on the schematic map.

## Limits of this checkpoint

No accessibility audit, load test, backup/restore, security scan, physical-device test or iOS run. Planned tests are not
passing tests; see HANDOFF for exact results.
