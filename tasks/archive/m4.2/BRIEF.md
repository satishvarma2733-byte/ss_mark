# Current task brief - M4.2 Extension

Objective: docs/06 M4.2 - "Staff decision, expiry, refreshed quote, atomic extension hold, captured incremental payment,
revised end/reminder; failure preserves original booking" (docs/03 C11, P06, extension deadlines; docs/05
extension_requests; docs/07 s.4, s.6; docs/08 T11) on web, Android and the API.

Protocol (docs/03 s.3 "three distinct phase deadlines"):
- Customer requests more time on an own CHECKED_IN booking before its end; whole increments; total <= maximum;
  must fit opening hours. REQUESTED, with a provisional price and no availability guarantee.
- Staff (assigned, TOTP) approve or decline within request + 5 minutes; approval only while the extension still
  looks feasible; it reserves nothing. APPROVED gives the customer decision + 5 minutes to start a hold.
- Hold: fresh price; the booking's own claim is widened to requested end + buffer under the same locks as holds; the
  exclusion constraint is the final guard (409 if the next booking or a blackout won). Hold deadline = min(hold +
  5 minutes, original end). Earlier deadlines never shorten a created hold.
- Payment: a separate payment order bound to the extension; only a verified, exact capture before the hold deadline
  applies it (booking end moves, claim stays widened, journal `allocation:extension:{id}`). Otherwise the capture is a
  full refund liability and the original booking is untouched. Expiry/cancel/check-out shrink the claim back.

Out of scope: end reminders (M4.6 reschedules them), native push.

Done when: race, deadline, late-capture and permission tests pass on real PostgreSQL; web and Android customers can
request, see the decision, pay and see the new end; staff decide on the arrivals desk; HANDOFF records results.
