# Current task brief - M4.5 Support and reviews

Objective: docs/06 M4.5 - "Eligible review creation/moderation, own support tickets, confidential incidents and contact
escalation; staff sees only necessary data" (docs/03 C12, C13, A03a, A03, A04; docs/05 reviews, support_tickets;
docs/07 s.3 reviews/support, s.4 admin support; docs/08 T14, T15) on web, Android and the API.

Rules:
- One review per COMPLETED booking, by its customer only; rating 1-5, optional text up to 2,000 characters; PENDING
  until support publishes or hides it (reason, audited). Venue pages show only published reviews and a summary.
- Customers and venue staff raise tickets about their own bookings/venue; they see only their own tickets and the
  customer-visible resolution, never private investigation notes. Safety tickets are confidential and high priority.
- Support (TOTP) triages: status, priority, assignment, resolution, private notes - all audited. Confidential tickets
  are visible only to superadmins and the support admin they are assigned to. Reporter contact details are not shown;
  a support admin can reveal them for a ticket with a reason (audited "contact escalation").
- Admin booking lookup (A03a/A03) for support/finance with TOTP: bounded search (reference, venue, date, exact
  customer email - audited), timeline with payments, refunds, extensions and tickets; no QR/PIN or payment secrets.
- Emergency copy routes users to local emergency services (112), not an in-app response promise.

Out of scope: refunds/finance actions from the lookup (M4.4), ticket notifications (M4.6).
