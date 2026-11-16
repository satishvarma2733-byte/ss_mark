# M4.5 plan: support and reviews

Written 2 November 2026. Earlier M4 records: `tasks/archive/m4.1`, `m4.3`, `m4.2`.

## Database (`supabase/migrations/20261103000300_support_reviews.sql`)

- `reviews` (one per booking, PENDING/PUBLISHED/HIDDEN, moderation fields), `support_tickets` (public ref, reporter
  and role, optional booking/venue, category, priority, status, confidential flag, assignment, customer-visible
  resolution), append-only `ticket_notes` (private). RLS forced, no client grants.
- Functions: `create_review`, `moderate_review`, `admin_review_queue`, `venue_reviews` (public summary + published);
  `create_ticket` (customer), `staff_report_incident` (venue staff), `my_tickets`, `my_ticket`, `admin_ticket_queue`,
  `admin_ticket_detail`, `admin_update_ticket`, `admin_ticket_contact` (audited reveal); `admin_booking_search`,
  `admin_booking_detail` (audited when searching by email); customer booking projection adds `review`.

## Server and clients

- Contracts/db/api-client; routes `POST /bookings/{id}/reviews`, `POST|GET /support-tickets`, `GET /support-tickets/{id}`,
  `POST /partner/incidents`, `/admin/reviews...`, `/admin/support-tickets...`, `/admin/bookings...`.
- Web: `/bookings/[id]/review` (C12), `/help` + `/support/[id]` (C13), venue reviews on C04, incident form on P06,
  `/admin/support`, `/admin/support/[id]` (A04), `/admin/reviews`, `/admin/bookings`, `/admin/bookings/[id]` (A03).
- Android: review screen from a completed booking, Help tab (tickets + emergency copy), venue reviews.

## Tests

Integration `support-reviews.test.ts`: review only own COMPLETED booking, once, validation; moderation permissions and
publication; public summary shows only published; tickets: own booking only, own reads only, notes never exposed to
reporters; staff incident scoped to their venue; confidential ticket hidden from unassigned support, visible to
superadmin/assigned; contact reveal audited and permissioned; booking search scope and audit. Web e2e: review +
moderation + venue page; support ticket -> admin triage -> customer sees resolution; incident access.
