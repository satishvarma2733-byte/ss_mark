# Venue rehearsal checklist (M6.1)

For each of the 5-10 pilot venues (D06/D07), in staging with the payment provider in test mode, before BOOKINGS opens.
Run by operations with the venue owner/manager and the staff who will work pilot shifts. Record date, people, result
and any fix per line. Uses only features that exist in the build (portal paths in brackets).

## A. Listing is true (owner/manager, operations checks on site)

- [ ] Partner application approved by an admin with eligibility evidence (`/admin/venues`).
- [ ] Name, address, map pin and directions match the real entrance.
- [ ] Photos are the venue's own or licensed (D08), approved in moderation, and show the actual tables.
- [ ] Each table: label staff use, real seating capacity, base rate (D02); tables that are not sold are paused or retired.
- [ ] Bookable hours and buffers match staffing; blackouts entered for known closures (`/partner/inventory`).
- [ ] Outside food, delivery and house rules are what staff will enforce; handover instructions name where to go.
- [ ] Policy version submitted and approved (`/partner/venue`); the venue page shows the same text.
- [ ] Amenities claimed are verified on site (unverified ones are labelled so).

## B. Staff can run a booking (each staff member, on their own phone or the venue device)

- [ ] Staff invited, accepted, signed in with TOTP enrolled (`/partner/staff`, `/staff`).
- [ ] Arrivals list for today shows a test booking with party size and table.
- [ ] Check in by scanning the customer's QR; again by typing the reference and PIN (camera refused or broken).
- [ ] Wrong-venue QR and an early arrival are refused with a clear message.
- [ ] Check out: table goes to CLEANING; mark READY; the next arrival is not blocked.
- [ ] Extension: customer asks for more time, staff approve within five minutes, customer pays, end time moves.
- [ ] No-show after the grace period, confirmed by staff.

## C. Things going wrong

- [ ] Table becomes unusable: pause it, place a closure; the manager (or support) cancels the affected booking for the venue
      (customer fully refunded; check the refund reaches PROCESSED in provider test mode).
- [ ] Venue closes unexpectedly: closure for the venue, affected customers cancelled and refunded, support informed.
- [ ] Incident reported by staff (confidential where needed) reaches support (`/admin/support`).
- [ ] Customer cancellation inside and outside the cutoff shows the right refund (D03 policy).
- [ ] Refund escalation: a failed refund is visible to finance and retried once (`/admin/bookings/{id}`).
- [ ] Support can reveal customer contact only with a reason, and the reveal is audited.

## D. People and hours (owner, D09)

| Role | Name | Hours | Contact channel | Backup |
| --- | --- | --- | --- | --- |
| Support lead | TBD | TBD | TBD | TBD |
| On-call engineer (critical alerts) | TBD | TBD | TBD | TBD |
| Finance (two people for payouts) | TBD, TBD | TBD | TBD | - |
| Superadmin (release switches) | TBD | TBD | TBD | TBD |
| Venue contact per venue | TBD | Pilot hours | TBD | TBD |

Published to customers: support hours and contact on the Help page (`/help`), which today shows proposed text.

## E. Sign-off per venue

| Venue | Date | Listing (A) | Staff (B) | Failures (C) | Signed by venue | Signed by operations |
| --- | --- | --- | --- | --- | --- | --- |
| TBD | | | | | | |
