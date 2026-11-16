# M3 implementation plan: discovery, quote, hold, payment, confirmation, arrival

Written 26 October 2026 before M3 edits. M2 records are in `tasks/archive/m2/`.
Root: `C:\Users\abhin\Desktop\Simply_Sit\build-kit`. No git commits (no project repository; the enclosing repo is the
home directory).

## Architecture decisions for M3

- **Payment truth stays in PostgreSQL.** New tables `payment_orders`, `payment_attempts` (+ append-only
  `payment_attempt_events`), `provider_events`, `refunds`, `ledger_accounts`, `ledger_journals`, `ledger_entries`.
  Booking, order, attempt, allocation and refund states are separate columns/tables (docs/07 s.7).
- **One confirmation path.** `app.apply_payment_observation` (internal, granted to nobody) is the only code that can
  move a booking to CONFIRMED. It locks venue -> resource -> booking -> order, samples `clock_timestamp()`, expires due
  holds first, then: exact captured amount + currency + provider + environment + order + live hold + active claim ->
  CONFIRMED with one allocation journal (`allocation:booking:{id}` unique). Anything else captured -> REFUND_DUE (late,
  cancelled, duplicate) or QUARANTINED (amount/currency mismatch) with a refund liability and job. AUTHORIZED never
  confirms. CAPTURED never regresses. Two wrappers call it: `app.verify_payment_for_customer` (authenticated, ownership
  checked; used by `POST /payment-orders/{id}/verify`) and `app.process_payment_observation` (worker role; used for
  webhooks and reconciliation).
- **Checkout protocol** (docs/07 s.3): `app.begin_checkout` persists the order (`ORDER_PENDING`, operation key) and moves
  HOLD -> PENDING_PAYMENT before any provider call; the provider order is created outside the transaction; then
  `READY`, or `UNKNOWN` on timeout (worker reconciles by receipt, never blindly re-creates). The hold deadline never
  moves.
- **Webhooks**: `POST /api/v1/webhooks/{provider}` verifies the HMAC over the raw body, then inserts the event (unique
  provider/environment/event_id) and an outbox job in one transaction; 200 means durably ingested. The worker re-fetches
  the payment from the gateway (server-side verification) before applying it.
- **Mock gateway** (`packages/providers/src/mock-gateway.ts` + web pages under `/mock-gateway`): Razorpay-shaped orders,
  payments, refunds, signed checkout callback and signed webhooks, with tester controls (pay, fail, authorize only,
  leave pending, duplicate/delayed webhook). State lives in a `mock_gateway` schema that the adapter creates on first
  use against a LOCAL database only (never in migrations). Disabled unless `PAYMENT_PROVIDER=mock` and `APP_ENV` is not
  production.
- **Arrival codes**: QR token and 6-digit PIN are derived with HMAC-SHA256 from a server secret (`ARRIVAL_CODE_SECRET`)
  and the booking ID; the database stores only SHA-256 hashes, set inside the confirmation transaction. The owner's
  client receives token/PIN from `GET /bookings/{id}` only while CONFIRMED/CHECKED_IN. Staff check-in passes the scanned
  token or reference+PIN to `app.staff_check_in`, which hashes and compares in the database, counts failed attempts per
  staff member (DB-enforced limit) and requires aal2, an assigned venue, the check-in window and a READY table.
- **Discovery**: `app.search_venues` (SECURITY DEFINER, published venues only) returns distance (PostGIS), from-price,
  food status, tags and, when a slot is given, the count of compatible free tables. `app.venue_day_availability` gives
  the per-table grid for a date. Both use a new non-raising `app.slot_problem` that `app.validate_slot` now also calls,
  so search and hold share one rule set. Manual areas come from a controlled pilot catalogue; device location is
  rounded to 2 decimals (~1 km) before it leaves the client and again on the server, and is never logged.
- **Map**: no maps provider is configured (D-list; Google Maps needs an owner account). Web and native draw a labelled
  schematic map (relative marker positions from public venue coordinates); the list remains the primary view.
- **M2 review fixes** (`tasks/archive/m2/REVIEW.md` R1-R4): venue-member RLS requires aal2; booking/event table reads
  limited to customer or MANAGER/OWNER; staff reads through a column-minimal function; hold checks current terms;
  `cancel_hold` expires due holds first, records the true previous status and closes payment orders; bearer sign-out
  reports Auth failures.

## Migrations (`supabase/migrations/`)

| File | Content |
| --- | --- |
| `20261026001100_m2_review_fixes.sql` | R1 policies (aal2 + manager-only booking reads), R2 terms check |
| `20261026001200_payments_ledger.sql` | payment tables, provider events, refunds, ledger + balanced posting, booking columns (`checkin_pin_hash`, `confirmed_at`), outbox kinds, failed-arrival log |
| `20261026001300_checkout_functions.sql` | begin_checkout, order ready/unknown, payment observation core + wrappers, refund liability, event ingestion, expiry/cancel rewrites, reconcile/refund job functions, customer projections |
| `20261026001400_discovery_arrival.sql` | slot_problem/validate_slot refactor, search_venues, venue_day_availability, staff arrivals projection, check-in/check-out/ready |
| `20261026001500_rls_grants_m3.sql` | RLS + grants for new tables and functions, PUBLIC revoke |

`seed.sql` unchanged except tags/coordinates if search needs them (consistency test must stay green).

## Application changes

- `packages/contracts`: discovery query/result, venue detail, availability, booking projection, checkout/order, verify,
  staff arrival schemas; new domain codes (`CHECK_IN_NOT_OPEN`, `TABLE_NOT_READY`, `ARRIVAL_CODE_INVALID`,
  `PAYMENT_PENDING`); pilot area catalogue.
- `packages/providers`: `PaymentGateway` interface; `MockGateway` (DB-backed, signatures); arrival-code HMAC helpers.
- `packages/db`: wrappers for every new function; customer booking/payment projections.
- `apps/web`: API routes `GET /venues`, `GET /venues/{id}`, `GET /venues/{id}/availability`, `GET /bookings`,
  `GET /bookings/{id}`, `POST /bookings/{id}/cancel-hold`, `POST /bookings/{id}/checkout`, `GET /payment-orders/{id}`,
  `POST /payment-orders/{id}/verify`, `POST /webhooks/mock`, `GET /partner/arrivals`, `POST /partner/check-in`,
  `POST /partner/bookings/{id}/check-out`, `POST /partner/resources/{id}/ready`; pages C01/C03 search + list/map, C04
  venue + availability grid, C05 book (quote/rules/accept/hold), C06 checkout (server countdown), C07 payment return,
  C08/C09 bookings with QR/PIN, staff arrivals; mock gateway pages.
- `apps/worker`: jobs `payment.provider_event`, `payment.reconcile_order`, `refund.submit`, `booking.confirmed`
  notifications; periodic reconciliation of UNKNOWN/stale orders.
- `apps/mobile`: search (area/location, filters, list/map), venue + availability, quote/accept/hold, checkout with
  countdown -> mock gateway in the system browser (`expo-web-browser`) -> deep-link return -> verify, bookings list and
  detail with QR/PIN, resume refresh. New native modules `expo-location`, `expo-web-browser` -> one dev-client rebuild.
- `scripts/local-env.mjs`: generate local-only random secrets (mock gateway key/webhook, arrival code).

## Tests and checks (completion criteria)

1. `pnpm db:reset` from empty (exit 0).
2. Integration (real PostgreSQL), new files `payments.test.ts`, `arrival.test.ts`, `discovery.test.ts`, plus updated RLS:
   T06 spoof/wrong amount/currency/environment/authorized-only; T07 duplicate + reordered events, failed-then-success
   attempts, extra capture -> refund liability, invalid signature; T08 late capture after expiry with B rebooked;
   capture vs cancel race in both orders; 10 concurrent checkouts -> one order; webhook + verify in parallel -> one
   confirmation/journal; balanced journals; RLS on payment tables; arrival rules (window, ready, wrong venue, aal1,
   attempts limit, idempotent repeat); discovery (published only, availability, capacity, distance/radius, tags).
3. Unit: mock gateway signatures, arrival codes, contracts, worker dispatch.
4. Web e2e (Playwright): search (manual area, filters, list/map), full journey to staff check-in, payment failure then
   retry, pending verification then webhook, hold expiry, late capture -> refund pending.
5. Android emulator: rebuilt dev client; search, book, mock pay via browser, deep-link return, process death during
   payment then resume, booking QR/PIN; screenshots.
6. lint, typecheck, unit, integration, build, e2e, test:mobile, secrets, expo check.

## Risks

- Scope: largest milestone; slices land database-first so the money/inventory core is proven before UI.
- Machine memory (~2.5 GB free); Android rebuild needs Supabase stopped or other load reduced.
- A mock gateway proves application logic only; Razorpay sandbox behaviour (actual payloads, native SDK, refund
  idempotency header) remains NOT RUN until D04 and owner test credentials.
- Proposed ledger posting is a placeholder for the finance-reviewed policy (D04).

## Rollback

New migration files only; deleting them and running `pnpm db:reset` returns to the M2 schema. Application changes are
additive except `/api/v1/venues` (new discovery contract; the native app is updated in the same milestone) and the
staff page.
