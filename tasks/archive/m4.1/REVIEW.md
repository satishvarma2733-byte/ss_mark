# Current review checkpoint - M4.1 cancellation and refund of confirmed bookings

Reviewed revision: working tree on 2 November 2026 (no git repository/commits exist). M3 review and fixes:
`tasks/archive/m3/REVIEW.md`.

## Independent review - NOT performed for M4.1

CLAUDE.md requires payment, permission and concurrency changes to be reviewed independently before release. M4.1 adds
all three. Below is the **author's own** review (same session that wrote the code), which does not satisfy that rule.
Recommended: a fresh read-only review session over the list at the end, either now or batched with M4.2 (extension
payments) before the M4 gate; docs/06 M5.1 still calls for human review of money code before live use.

## Author self-review

| Area | Checked | Evidence |
| --- | --- | --- |
| Refund amount source | Policy snapshot of the booking and its single BOOKING-allocated capture only; the client's `expected_refund_paise` is compared, never used | `cancellation_terms`, `cancel_booking`; test "refuses when the refund shown no longer applies" |
| Time | Database clock sampled after the locks (`app.lock_booking`); exactly at the cutoff is early; after the start refused (service: after the end) | boundary tests at -2:00:00, -1:59:59.999999, 0; "refuses ... already-started" |
| Lock order | venue -> resource -> booking (lock_booking) -> attempt FOR UPDATE, the same order as payment observation and refund results | cancel vs check-in race x3; 5 concurrent cancels -> one cancellation, one refund |
| Over-refund | One CONFIRMED -> CANCELLED transition; unique journal key `cancellation:booking:{id}`, refund operation key `refund:booking:{id}:cancel`, event business key; per-attempt refund ceiling trigger | repeat cancel refused with one refund; duplicate capture + cancel -> two refunds on two attempts, extra refund rejected |
| Ledger | `CANCELLATION_REFUND_DUE` moves booking liability to refund liability; `REFUND_PROCESSED` on provider evidence; every journal balanced | integration `expectBalanced` |
| Permissions | Customer: owner only, others NOT_FOUND (staff too). Service: assigned MANAGER/OWNER or SUPPORT/SUPERADMIN, aal2, reason 3-500 chars, audited; STAFF FORBIDDEN; outsiders NOT_FOUND. Grants: 3 entry points to `authenticated`, internals to nobody, PUBLIC revoked | integration + e2e (manager aal1 REAUTH, staff 403, outsider 404) |
| Idempotency | Routes require Idempotency-Key (actor + route + key + body hash); clients reuse the key on retry and make a new one when the body changes | e2e replay returns the identical result; new key after cancel -> 409 |
| Honest states | CANCELLED is not REFUNDED; "refunded" only when the refund is PROCESSED with a provider refund ID | web/native copy; Android evidence `android-03`/`android-04` |

### Found while building and fixed

| ID | Finding | Fix |
| --- | --- | --- |
| C1 | Customer and service reason codes shared `bookings.cancel_reason`; both lists contain `OTHER`, so a customer choosing "Another reason" would have been told the venue cancelled with a full refund | Stored values are namespaced `CUSTOMER:<code>` / `SERVICE:<code>`; the notice keys on the `SERVICE:` prefix; unit tests for the shared copy |
| C2 | Native cancel screen returned with `router.back()`, landing on a different booking when opened from a link | `router.dismissTo` the cancelled booking; rechecked on the emulator |
| C3 | Test-only: postgres.js sends a timestamptz parameter through a JavaScript Date, dropping microseconds, so the "1 microsecond after the cutoff" case was not tested as written | The test passes instants as text (`::text::timestamptz`) |

### Open / accepted

- A1 Retained amounts (late cancellations) remain `CUSTOMER_BOOKING_LIABILITY`; revenue recognition and venue share
  are M4.4. The BOOKING-allocated attempt keeps `allocation_state = BOOKING` after cancellation (REFUNDED applies only
  to refund-due money); finance views must read refunds for cancelled bookings.
- A2 A FAILED cancellation refund stays owed (audited `refund.failed`, counted in queue metrics); operator path M4.4.
- A3 Venue managers can service-cancel without platform approval or limits (audited with reason). Whether venue
  cancellations need approval, penalties or ranking effects is an owner/policy question for M4.3/M4.4.
- A4 Staff receive FORBIDDEN (not NOT_FOUND) for service-cancel at their own venue, revealing only that a booking ID
  exists at their venue, which they can already see in arrivals.
- A5 A customer whose profile is DELETION_PENDING cannot cancel (`require_active_profile`); support can service-cancel.
  Revisit with M4.5 support.
- A6 One `booking_cancelled` notice template for customer and service cancellations; wording per cause is M4.6.

### For the independent reviewer

`supabase/migrations/20261102000200_cancellation.sql`; `apps/web/app/api/v1/bookings/[id]/{cancel-preview,cancel,
service-cancel}/route.ts`; `apps/web/app/bookings/[id]/cancel/*`; `apps/mobile/app/cancel/[bookingId].tsx`;
`packages/contracts` cancellation section; `tests/integration/cancellation.test.ts`; interaction with
`app.record_refund_result`, `app.apply_payment_observation` (captures after cancellation) and `app.staff_check_in`.
