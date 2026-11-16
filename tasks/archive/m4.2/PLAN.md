# M4.2 plan: extensions

Written 2 November 2026. M4.3 records: `tasks/archive/m4.3/`.

## Database (`supabase/migrations/20261103000200_extensions.sql`)

- `extension_requests` (docs/05): booking, requested/original end, incremental price snapshot, status
  REQUESTED/APPROVED/DECLINED/HELD/PENDING_PAYMENT/APPLIED/EXPIRED/CANCELLED, three deadlines, decision fields,
  base booking version, version; one non-terminal request per booking.
- `payment_orders.extension_id`; the one-active-order index becomes one per booking (booking orders) and one per
  extension. Booking payment summary ignores extension orders.
- `guard_booking`: `end_at` may move only to the requested end of that booking's HELD/PENDING_PAYMENT extension.
- `expire_resource_holds` also expires due extension phases (and shrinks widened claims); the worker sweep includes
  resources with due extensions.
- Functions: `request_extension`, `decide_extension` (staff), `hold_extension`, `begin_extension_checkout`,
  `cancel_extension`, `staff_extension_requests` (desk), extension in `customer_booking_json` and
  `partner_booking_detail`; `apply_payment_observation` gains the extension branch (apply only before the hold
  deadline, else LATE_CAPTURE/DUPLICATE_CAPTURE refund); `staff_check_out` cancels an open extension;
  `orders_to_reconcile` polls live extension orders every minute; job `extension.notify` for customer notices.

## Server and clients

- `packages/payments`: `startExtensionCheckout`; verify gate looks at the extension, not the checked-in booking.
- Web API: `POST /bookings/{id}/extension-requests`, `POST /partner/extension-requests/{id}/decision`,
  `POST /extension-requests/{id}/hold`, `POST /extension-requests/{id}/checkout`, `POST /extension-requests/{id}/cancel`,
  `GET /partner/extension-requests?venue_id`.
- Web: `/bookings/[id]/extend` (C11) with phase, server deadline and pay; staff desk shows pending requests with
  Approve/Decline; payment return shows the extension outcome.
- Android: extend screen from the booking; same payment return path.

## Tests

Integration `extensions.test.ts`: request validation (not checked in, too long, outside hours, duplicate open);
staff decision window and permissions; approve refused when infeasible; hold widens claim and blocks the next
booking; next booking first -> hold 409, original intact; deadlines (approval expiry, hold capped at original end,
earlier deadlines do not shorten a hold); capture applies once; late capture after expiry -> refund, end unchanged;
duplicate capture -> refund; expiry shrinks the claim; check-out cancels an open extension; journals balanced.
Web e2e: request -> staff approve on the desk -> hold -> pay -> new end shown. Android: same flow on the emulator.
