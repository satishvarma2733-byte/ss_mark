# Review checkpoint - M4.2 extensions

Independent review: **NOT performed**. This slice changed the payment confirmation core (`apply_payment_observation`),
so it is the first item for the independent money/concurrency review (with M4.1 and M4.4).

## Author self-review

| Area | Checked | Evidence |
| --- | --- | --- |
| Deadlines | request + 5 min (decision), decision + 5 min (hold), min(hold + 5, original end); earlier deadlines never shorten a hold; all at the database clock after locks | integration deadline tests |
| Inventory | Hold widens the booking's own claim under venue -> resource -> booking locks; exclusion constraint is the final guard; expiry/cancel/check-out shrink it | race x3 (exactly one winner), shrink tests |
| Money | Separate order per extension; exact capture before hold deadline applies once (`allocation:extension:{id}`); late -> LATE_CAPTURE refund; second -> DUPLICATE_CAPTURE refund; booking order summary unaffected | integration payment tests |
| Booking immutability | `end_at` can change only to the requested end of that booking's HELD/PENDING_PAYMENT extension | guard + apply path |
| Permissions | Customer owner only; staff of that venue with TOTP decide; others NOT_FOUND; staff see no prices | integration decision test |
| Verify gate | Extension orders settle only when APPLIED, so an expired extension's late capture is still observed and refunded | code + payment return copy |

### Open / accepted

- E1 A failed decision/hold after a deadline rolls back the expiry it detected; the worker sweep (or the next locked
  call) records it. The customer and staff see the refusal immediately.
- E2 The extension price is base time only (no second service fee) - pilot proposal pending D02.
- E3 The booking total stays the original amount; extensions are separate receipt lines and journals.
- E4 Staff desk polls every 10 s and the customer page every 4 s (no push yet).
