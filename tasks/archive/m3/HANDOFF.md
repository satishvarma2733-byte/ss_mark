# Current handoff - M3 Core journey

Dates: 26 October - 2 November 2026. Root: `C:\Users\abhin\Desktop\Simply_Sit\build-kit`. Plan: `tasks/current/PLAN.md`.
Brief: `tasks/current/BRIEF.md`. Review: `tasks/current/REVIEW.md` (independent M3 review NOT performed).
M1/M2 records: `tasks/archive/m1/`, `tasks/archive/m2/` (M2 independent review performed at the start of M3; see its
REVIEW.md).

## Status

M3 is implemented and checked locally against the **mock payment provider** (no provider account exists, D04):

- Database: 5 new migrations (`001100`-`001500`) apply from empty with the seed; payment orders/attempts/observations,
  provider events, refunds, a balanced append-only ledger and arrival attempts; one confirmation path.
- Web: search (pilot area or approximate location, slot, party, use case, filters) with list and schematic map; venue
  rules and per-table times; quote -> accept -> hold; checkout with server countdown; mock hosted checkout; payment
  return that confirms only from the server; bookings with QR + PIN; staff arrivals (check-in, check-out, mark ready).
- Worker: webhook processing, refund submission, confirmation/refund notifications, reconciliation of missing webhooks
  and uncertain order creation.
- Android (emulator, development build): search with location denial, list/map, venue rules, quote, hold, mock
  payment in a Custom Tab, process death during payment with resume to the server-confirmed booking, QR + PIN, staff
  check-in of that booking, offline behaviour. One defect found on device and fixed (see Native evidence).
- iOS: **NOT RUN - no access** (owner: product owner; EAS iOS development build or macOS + iPhone).
- Real payment provider sandbox, native provider SDK, maps provider: **NOT RUN** (no accounts). The M3 real-payment gate
  (docs/06) is therefore **not passed**; the application logic is proven against the mock only.
- Independent review of M3 money/inventory/arrival code: **performed 2 Nov 2026** (separate agent, read-only; not a
  human review): 0 Critical, 0 High, 2 Medium, 7 Low, 8 Info. All Medium/Low and most Info findings fixed with tests;
  F13 (void authorizations) deferred to the real provider; F10 accepted. Details: REVIEW.md.
- Expo SDK 58 patch upgrade applied (expo 58.0.22, react-native 0.88.1, ...); dev client rebuilt and smoke-tested.

## M2 independent review (start of M3)

Performed by a fresh session (same model family, no M2 authoring context; not a human review). No critical/high
findings. Fixed in M3 with regression tests: R1 venue-member reads need aal2 and staff no longer read booking rows
(prices, customer IDs); R2 holds need the current terms version; R3 `cancel_hold` expires due holds first and records
the true previous status; R4 bearer sign-out reports a failed revocation (503); R7 body limit now counts bytes.
Deferred with owners: R5 (admin grant FK -> 404, M4), R6 (anon can see table readiness - owner decision), R8 (quote rate
limit, M5). Details: `tasks/archive/m2/REVIEW.md`.

## What changed

Database (`supabase/`):
- `20261026001100_m2_review_fixes.sql` - R1/R2.
- `20261026001200_payments_ledger.sql` - `payment_orders` (one active per booking, operation key, creation lease,
  provider reference immutable), `payment_attempts` (never merged; state never regresses; allocation forward-only; one
  BOOKING allocation per booking), append-only `payment_attempt_events`, `provider_events` (unique provider/env/event),
  `refunds` (non-failed total <= captured, PROCESSED needs provider ID), `ledger_accounts/journals/entries` (append-only,
  balanced at commit), `arrival_attempts`; `bookings.confirmed_at`, `checkin_pin_hash`; new outbox kinds.
- `20261026001300_checkout_functions.sql` - `begin_checkout`, order creation claim/record/unknown,
  `apply_payment_observation` (internal) + `process_payment_observation` (worker), event ingestion, reconciliation
  candidates, refund submission/results, notifications; `expire_resource_holds` now closes payment orders;
  `create_booking_hold` (R2) and `cancel_hold` (R3) rewritten.
- `20261026001400_discovery_arrival.sql` - `slot_problem` shared by holds and search, `price_for`, `search_venues`,
  `venue_detail`, `venue_day_availability`, customer booking/payment projections, `staff_arrivals`, `staff_check_in`,
  `staff_check_out`, `staff_mark_ready`, `venue_bookings_calendar`.
- `20261026001500_rls_grants_m3.sql` - read policies (customer own; finance needs aal2), function grants, PUBLIC revoke.
- `20261102000100_m3_review_fixes.sql` - review fixes: reconciliation selection/pacing/claiming, observation
  de-duplication and mismatch evidence/quarantine, refund reconciliation (`refunds.reconciled_at`,
  `app.refunds_to_reconcile`), refund lock order, FAILED refund audit, queue metrics for refunds/quarantine, open
  attempts in the payment summary, serialized check-in failure limit, MFA for the superadmin arrival-log read.
- `seed.sql` - adds the LOCAL `mock_gateway` schema (never a migration).

Packages:
- `packages/payments` (new, server-only): checkout start, reconcile-before-create order creation, verification from
  provider fetches, webhook event processing, reconciliation, refund submission. Lint blocks it from clients.
- `packages/providers`: `PaymentGateway` interface + `MockGateway` (orders, payments, refunds, signed callback and
  webhooks, fault injection); M1 in-memory payment stub removed; mock gateway and arrival secret loaders.
- `packages/domain`: `arrival.ts` (HMAC QR token / PIN; hashes only stored).
- `packages/contracts`: discovery, venue, availability, quote/hold, booking, checkout/payment, staff arrival schemas;
  pilot area catalogue; coarse location rounding; cursors; codes CHECK_IN_NOT_OPEN, TABLE_NOT_READY, ARRIVAL_CODE_INVALID.
- `packages/db`: wrappers for every new function; `/partner/bookings` now uses the calendar function.
- `packages/api-client`: search, venue, availability, quote, hold, bookings, cancel-hold, checkout, payment status/verify.

Web (`apps/web`): API routes `GET /venues` (new contract), `GET /venues/{id}`, `GET /venues/{id}/availability`,
`GET /bookings`, `GET /bookings/{id}`, `POST /bookings/{id}/cancel-hold`, `POST /bookings/{id}/checkout`,
`GET /payment-orders/{id}`, `POST /payment-orders/{id}/verify`, `POST /webhooks/mock`, `GET /partner/arrivals`,
`POST /partner/check-in`, `POST /partner/bookings/{id}/check-out`, `POST /partner/resources/{id}/ready`. Pages `/`
(search form), `/venues` (list/map/filters/empty/invalid), `/venues/[slug]` (rules + times), `/venues/[slug]/book`,
`/checkout/[id]`, `/payment/return`, `/bookings`, `/bookings/[id]` (QR + PIN), `/staff` (arrival desk), `/mock-gateway/*`.

Worker (`apps/worker`): new handlers `booking.confirmed`, `refund.requested`, `payment.provider_event`, `refund.submit`;
reconciliation each tick.

Mobile (`apps/mobile`): search tab (areas, approximate location on tap, date/time/duration/party/use case, list and
schematic map), venue + times, book (quote/accept/hold), checkout (countdown, Pay in a browser tab, release), payment
return (deep link `simplysit-dev://payment-return`), bookings tab, booking detail with QR + PIN; launch resume of an
in-flight payment (`lib/pending-payment.ts`, `app/_layout.tsx`); search paging ("Show more spaces"). New modules
`expo-web-browser ~58.0.6`, `expo-location ~58.0.19` (coarse only: ACCESS_FINE_LOCATION removed from the manifest),
`expo-crypto ~58.0.7`, `qrcode 1.5.4`. Removed `lib/venues.ts` (synthetic-only loader, superseded by the API).

Scripts/config: `scripts/local-env.mjs` generates and keeps local secrets; Playwright server points the mock gateway at
port 3100; `docs/agent-context.md` M3 status.

## How to run

```
cd C:\Users\abhin\Desktop\Simply_Sit\build-kit
pnpm install --frozen-lockfile
pnpm db:start && pnpm db:reset && pnpm env:local
pnpm dev:web          # http://localhost:3000 ; mock provider console: /mock-gateway/console
pnpm dev:worker       # webhooks, refunds, notifications, reconciliation (stop any other worker first)
pnpm test:integration # real PostgreSQL + mock gateway
pnpm --filter @simply-sit/web build && pnpm test:e2e
```

Demo journey: `/venues?area=koramangala` -> a venue -> a time -> sign in (fixture `customer.a@example.test`, code in
Mailpit http://127.0.0.1:54424) -> accept -> hold -> Pay -> "Pay (success)" on the mock page -> booking with QR/PIN.
Staff: `staff.cafe@example.test` at `/staff` (enrol an authenticator when asked). Seeded venues need a 15-minute lead,
so their check-in window opens 15 minutes before the start; e2e uses fictional quick-turn venues (5-minute grid).

## Checks run and results

Final sequence on 2 November 2026 after the review fixes and the Expo upgrade, in this order, one log per step:

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm secrets:check` | PASS |
| `pnpm lint` | PASS (client boundary also blocks `@simply-sit/payments`) |
| `pnpm typecheck` | PASS - 11 workspace projects |
| `pnpm test:unit` | PASS - 11 files, 62 tests |
| `pnpm db:reset` | PASS - 16 migrations + seed (incl. local `mock_gateway`) from empty |
| `pnpm test:integration` | PASS - 11 files, 113 tests on real PostgreSQL (payments 22, payments-recovery 11, arrival 12, discovery 7, RLS, outbox, inventory, time, snapshots, consistency, fixtures) |
| `pnpm build` | PASS - Next.js build + proxy; worker bundle 875.5 kB |
| `pnpm test:e2e` | **27/27** on the final run. Earlier full runs the same afternoon: one failure was a bug in a new test (Playwright JSON-encoded a string body, fixed); two M2 tests collided with their own data from previous runs on fixed seeded slots (fixed: they now use their own fictional venues); two runs each failed one **sign-in** step intermittently (local Auth returned 500 "database error on committing ... context deadline exceeded"; another time the staff page did not appear after TOTP enrolment). Those were not assertions about our code; the local Docker stack was under load (another project's container in a restart loop). Recorded as an environment flake to watch. |
| `pnpm test:mobile` | PASS - Android and iOS Hermes bundle export (rerun after the native search paging change) |
| `expo install --check` | PASS - dependencies up to date after `expo install --fix` |

What the integration tests prove (docs/08):
- T06: confirmation only from a provider-fetched exact capture; forged client success, authorized-only, wrong amount,
  wrong currency, wrong order/environment and a customer token calling the confirmation function all fail to confirm.
- T07: failed then captured attempts kept separately; a delayed FAILED never regresses CAPTURED; a second capture
  becomes one full refund liability submitted once (one provider refund); webhook deliveries deduplicated by event ID;
  an event that beats our order record is retried, then quarantined; webhook, verify and reconcile racing confirm once.
- T08: A's hold expires, B books the table, A's late capture -> refund-due, B untouched, one active claim; capture after
  a cancelled hold -> refund-due; a confirmed booking cannot be abandoned.
- Checkout: ten simultaneous Pay requests -> one payment order and one provider order; a timeout -> UNKNOWN, then
  reconciliation by receipt finds the order without creating another; provider refused -> hold kept, retry reuses order.
- Ledger/refunds: every journal balanced (unbalanced rejected at commit; entries immutable); refunds cannot exceed the
  captured amount.
- Arrival (AC-07, T13, T14): reference+PIN and QR check-in once; wrong/other-venue/unknown codes get one generic
  answer and are logged; per-staff rate limit; aal2 and assignment required; too-early and "earlier claim still holds"
  refused; check-out completes, revokes codes, keeps the paid interval, sets CLEANING; only staff mark READY; staff see
  arrivals without prices or customer IDs.
- Discovery (T01, T03): published only; party size, tags, amenities, categories; radius and rounded origin; slot
  availability and available-only filter; paging; day availability honours hours, the buffer and existing holds.
- M2 review fixes: R1 (aal2, manager-only booking rows), R2 (current terms).

Web e2e (Playwright, production build, 24 tests): full journey search -> venue rules -> sign-in -> quote -> accept ->
hold -> mock provider -> verified confirmation -> QR/PIN -> staff MFA check-in (wrong PIN first) -> check-out -> mark
ready; declined then retried payment (two attempts kept); authorized-only stays pending until the provider captures;
capture after expiry never confirms (table released, full refund pending); release a hold; another customer's booking
not shown; search list/map/empty/invalid filter/invalid cursor/unpublished; unsigned and forged webhooks rejected
before storage; plus the 17 M2 auth/session/API tests.

## Native evidence (Android)

2 November 2026, emulator `simplysit_api36` (Android 36, x86_64), debug dev client `com.simplysit.customer.dev`
rebuilt on 27 Oct for the new native modules (`assembleDebug -PreactNativeArchitectures=x86_64`, 79.5 MB, 1 min 16 s
with warm caches). API via `adb reverse` to the local web dev server, worker running. Fictional fixtures: venue
`native-quick-cafe` (5-minute grid, no lead), `native.m3.customer@example.test`, `native.m3.staff@example.test`.
Screenshots in `tasks/current/evidence/m3/`.

| Item | Evidence | Status |
| --- | --- | --- |
| Location asked only after a tap, approximate only; denial falls back to areas, no re-prompt | `android-02-location-permission.png` (system dialog: "approximate location"), `android-03-location-denied.png`; manifest has ACCESS_COARSE_LOCATION only | PASS |
| Search list and schematic map by area | `android-01-search.png`, `android-04-map.png` | PASS |
| Sign-in with emailed code | `android-05-signed-in.png` | PASS |
| Venue rules before selection; server quote; accept; hold with server countdown | `android-06-venue-rules.png`, `android-07-quote.png` (14:05-15:05 IST, Rs 360.00, Restricted/Not allowed), `android-08-checkout-held.png` | PASS |
| Pay opens the provider page in a Custom Tab | `android-09-provider-tab.png`, `android-12-provider-tab-before-kill.png` | PASS |
| Return link to a running app shows the server result | `android-11-return-link-warm.png` ("Booking confirmed", SS-MGCSHA8BDB) | PASS |
| Return link on a cold start (development client) | `android-10-defect-cold-start-lands-on-home.png` - dev launcher drops the path | DEFECT -> fixed by launch resume (below); release-build link routing NOT RUN |
| Process death while the payment is pending: app force-stopped; provider records PENDING then captures later (two signed webhooks, worker processes them); app opened from the launcher | Server: SS-TFRTQQJM92 `WEBHOOK:PENDING, WEBHOOK:CAPTURED` -> CONFIRMED; app resumed to "Booking confirmed" (`android-13-relaunch-resumes-confirmed.png`) | PASS (after fix) |
| QR (native views) and PIN on the confirmed booking | `android-14-booking-qr-pin.png` | PASS |
| Staff check-in of the Android booking (staff signed in by emailed code + TOTP through the real API) | wrong PIN -> 422 ARRIVAL_CODE_INVALID; reference + PIN from the phone -> 200 CHECKED_IN, table OCCUPIED; phone shows "Checked in" on resume (`android-15-checked-in.png`) | PASS |
| Bookings list from the server | `android-16-bookings-list.png` | PASS |
| Upgraded dev client (react-native 0.88.1, Expo 58.0.22; rebuilt APK 72.8 MB): sign-in, hold, pay in the Custom Tab, return to the running app | "Booking confirmed" SS-WZREC59HCM (`android-20-upgraded-client-confirmed.png`) | PASS |
| Native search paging ("Show more spaces", added after the device run found results capped at 20) | demo venue reached at result 52 of 81 (`android-21-search-load-more.png`) | PASS |
| Offline (API tunnel removed): bookings show the offline message; a quote/hold attempt says nothing was held and the database has no booking; restoring the connection and "Get a fresh quote" recovers | `android-17-offline-bookings.png`, `android-18-offline-no-hold.png`, `android-19-back-online-quote.png` | PASS |
| Unplanned duplicate payment on an already-paid order | SS-MGCSHA8BDB stayed CONFIRMED; second capture -> DUPLICATE_CAPTURE refund -> PROCESSED by the worker; 3 balanced journals | Handled as designed (REVIEW.md) |
| Physical Android device | none attached | NOT RUN |
| iOS (build, Keychain, Custom Tab equivalent, deep links) | Windows host, no macOS/iPhone/EAS access | **NOT RUN - no access** |

Device-run fixes (re-verified on the emulator): launch resume for an in-flight payment (`lib/pending-payment.ts`,
`app/_layout.tsx`); "No payment received yet" copy on web and native.

Emulator notes: with ~1 GB free RAM on 27 Oct the emulator's system process stopped responding repeatedly and holds
expired while the UI was frozen (the server expired them correctly; the app showed "hold ended" on resume). The 2 Nov
run had ~10 GB free and was stable. Metro watch mode fails on this machine ("Failed to start watch mode"); run Metro
with `CI=1` and restart it after code changes.

## Not verified

- iOS (build, Keychain, deep link return, QR): NOT RUN - no access.
- Real payment provider sandbox, native SDK, signature format, refund idempotency header: NOT RUN (D04).
- Maps provider: NOT RUN (schematic placeholder).
- Webhook path through a running worker: not in the web e2e suite (e2e confirms through the server verify path);
  exercised on the Android run (pending + captured webhooks processed by `pnpm dev:worker`) and in `payments.test.ts`.
- Cold-start deep-link routing in a release (non-development) build: NOT RUN; the app no longer depends on it.
- Pilot-scale search/availability plans and load (T21): not measured (seed scale: search 96 ms, day availability 8 ms).
- Physical Android device: NOT RUN.
- Review gaps still without tests: worker crash mid provider call for the M3 handlers, order-creation lease takeover,
  grace-elapsed check-in, exact `db_now = hold_expires_at` instant (REVIEW.md).

## Unresolved issues and owners

- iOS access - product owner. Payment provider account and marketplace eligibility (D04) - product owner.
- Maps provider account - product owner.
- Owner decisions still open: D02-D10; proposed policies shown as "proposed" in every surface.
- QUARANTINED payments (amount/currency mismatch) need the M4 admin refund path.
- R6: whether live table readiness may be public - product owner.

## Machine state left behind

- The machine restarted between 27 Oct and 2 Nov; Docker Desktop was started again on 2 Nov and both local Supabase
  projects came back on their own (Djain untouched). The orphaned M2 worker that had blocked `outbox.test.ts` on
  27 Oct is gone; that suite now runs.
- Running: this project's local Supabase stack (stop with `pnpm exec supabase stop` from build-kit).
- Stopped: emulator, web dev server, worker, every Metro instance started this session (stopping a background task
  leaves its `node` child running on Windows, so those were stopped by PID).
- Local database: reset by the final check run, then test data from the integration and e2e suites.

## Rollback

Delete migrations `20261026001100`-`20261026001500` and run `pnpm db:reset` to return to the M2 schema (M2 review fixes
would then be reverted too). Application changes are additive except: `GET /api/v1/venues` contract (mobile updated in
the same change), staff reads (R1), the providers package payment stub (removed), mobile `lib/venues.ts` (removed).

## Next concrete task

1. M4.1 cancellation and refund of confirmed bookings (customer cancel with policy preview, venue/service cancel with
   full refund), then M4.3 partner operations; M4.2, M4.5, M4.4, M4.6 in dependency order.
2. Owner: payment provider account (D04) for sandbox evidence; maps provider account; iOS access; whether commission
   terms must be hidden from customers (REVIEW.md F7).
