# Current handoff - M2 Data and auth

Dates: 26 October 2026. Root: `C:\Users\abhin\Desktop\Simply_Sit\build-kit`. Plan: `tasks/current/PLAN.md`.
Brief: `tasks/current/BRIEF.md`. Review: `tasks/current/REVIEW.md` (independent review NOT performed).
M1 records: `tasks/archive/m1/`.

## Status

M2 is implemented and checked locally (database, web, worker, Android emulator). It is not "released" or reviewed:

- Database (M2.1/M2.3/M2.4/M2.5): 10 migrations + synthetic seed apply from empty; 60 integration tests on real PostgreSQL
  pass; hot-query plans checked at pilot scale (see "M2 re-verification").
- Web auth (M2.2): email one-time code sign-in, httpOnly cookie sessions, sign-out, terms, deletion request, TOTP MFA for
  portals; 14 Playwright tests pass (browser and bearer API paths).
- Worker (M2.5): PostgreSQL outbox, leases, backoff, dead-letter, heartbeat; crash recovery demonstrated.
- Android (M2.2 native): development build with secure-store sessions; sign-in, restore after kill, sign-out with
  server revocation, terms, deletion request and revoked-session handling all run on the emulator (see Native evidence).
- iOS: **NOT RUN - no access** (unchanged from M1; owner: product owner; EAS iOS development build or macOS + iPhone).
- Independent review of money/inventory/permission code: NOT PERFORMED (docs/06 M2.3 requires it).
- CI and hosted environments: NOT RUN (no GitHub remote, no hosting account).

## What changed

Database (`supabase/`):
- `config.toml`: site URL/redirect allowlist; 6-digit email code, 10-minute expiry, 60 s resend cooldown; code-only email
  template `templates/otp-code.html`; TOTP MFA enabled; buckets `venue-media` (public) and `privacy-exports` (private);
  realtime, edge runtime, analytics/vector and storage vectors disabled (unused; memory-constrained machine).
- Migrations `20261026000100` ... `20261026000900` (see PLAN for the file list) plus `20261026001000_rls_initplans.sql`
  (performance fix, see "M2 re-verification"): 25 tables, all with RLS enabled and forced;
  no client INSERT/UPDATE/DELETE grants anywhere; writes only through `app.*` SECURITY DEFINER functions in a schema that
  PostgREST does not expose. Exclusion constraint `no_active_overlap` on `inventory_claims`; rate periods cannot overlap;
  published policies, approved fee configs, historical rates, booking snapshots/identity, booking events and audit events
  are immutable; booking status transitions enforced in the database.
- `seed.sql`: 8 DEMO venues (all 6 categories, overnight brewery, off-peak restaurant, one DRAFT), 10 tables, published
  policies equal to `POLICY_PROPOSED_2026_10_25`, SANDBOX-ZERO fee config (synthetic, zero commission/fees/tax), weekly hours,
  6 fixture accounts `*@example.test` (customers A/B, cafe staff, cafe manager, lounge staff, superadmin - local only).

Packages:
- `packages/db` (new, server-only): postgres.js 3.4.9 client, `asAnon` / `asUser` / `asWorker` (SET LOCAL ROLE + verified
  claims), domain-error mapping, typed wrappers for every `app.*` function.
- `packages/contracts`: docs/07 error envelope (snake_case, `request_id`, `field_errors`) and `DOMAIN_ERRORS` catalogue;
  auth, me, quote, hold, closure, privacy schemas.
- `packages/api-client`: new envelope; bearer-token calls (`getMe`, `acceptTerms`, `requestPrivacy`, `signOut`).
- `packages/synthetic-data`: cafe "from" price corrected to the cheapest table (bug found by a consistency test).
- `eslint.config.mjs`: the client boundary rule now also blocks `@simply-sit/db` from mobile and client packages.

Web (`apps/web`):
- `proxy.ts` (Next 16 replacement for middleware) refreshes sessions for pages.
- `lib/auth/*`: Supabase server/token clients, httpOnly cookie policy, identity (cookie XOR bearer; ambiguous -> 400),
  claims decoding. `lib/api.ts`: envelope, body limits, strict schemas, origin check, redirect allowlist, idempotency.
  `lib/rate-limit.ts` (per-process). `lib/portal*.ts` gating.
- API: `auth/otp/request`, `auth/otp/verify`, `auth/sign-out`, `auth/mfa` (+`enroll`, `verify`), `me`, `me/terms`,
  `privacy-requests`, `quotes`, `booking-holds` (Idempotency-Key required), `partner/bookings`,
  `partner/resources/[id]/closures` (Idempotency-Key), `admin/metrics`. `venues` now reads the database (anon + RLS).
- Pages: `/sign-in`, `/account`, `/account/security` (TOTP), `/partner`, `/staff`, `/admin` gated (sign-in, role, aal2).
  Venue page now shows real per-table hourly prices, hours and published food/delivery rules from the database.

Worker (`apps/worker`): `loop.ts` (expire holds, lease, dispatch, complete/fail, heartbeat), `worker.ts` (pure dispatch),
`index.ts` (config validation, graceful stop). Handlers: hold expired -> in-app + email notifications; email via
MockEmailProvider with the notification ID as idempotency key; deletion request -> NEEDS_REVIEW; diagnostic sleep.

Mobile (`apps/mobile`): `lib/supabase.ts` (secure-store session, foreground-only refresh), `lib/secure-storage.ts` (chunked
adapter, unit tested), `lib/api.ts` (bearer client), Account tab sign-in/out/terms/deletion, `expo-secure-store` config
plugin (Android backup exclusion), packages `@supabase/supabase-js 2.118.0`, `expo-secure-store ~58.0.2`,
`react-native-url-polyfill 4.0.0`.

Scripts: `scripts/local-env.mjs` (`pnpm env:local`), `scripts/worker-crash-demo.mjs` (`pnpm demo:worker-crash`),
`scripts/bootstrap-admin.mjs` (owner-run superadmin bootstrap; refuses non-local unless explicitly confirmed).
Tests: `tests/integration/{helpers,inventory,time,snapshots,consistency,rls,outbox,fixtures}`, `apps/web/e2e/{auth,api-auth}`,
`apps/web/lib/auth.test.ts`, `apps/mobile/lib/secure-storage.test.ts`, updated worker/contracts/api-client tests.

## Brand logos (owner-supplied, 26 October 2026)

- Sources kept unchanged in `references/brand/logo/` (olive `#373822` / cream `#F5F1E5` monogram and lockup, PNG; hashes
  in its README). Derived assets come from `python -I scripts/generate-brand-assets.py` (Pillow; no recolouring/redrawing).
- Web: cream monogram in the header with a spaced-capitals wordmark; olive lockup on the home page; olive monogram on
  `/sign-in`; favicon `app/icon.png` and `app/apple-icon.png` (olive monogram on logo cream).
- Native: app icon, Android adaptive icon (olive foreground, logo-cream background, monochrome themed layer), splash via
  `expo-splash-screen ~58.0.11` (monogram on logo cream), olive lockup above the venue list, monogram on the sign-in card.
- Checks after the change: lint, typecheck, unit (51 incl. new tagline contrast test), web build, e2e 14/14, native export,
  secrets - PASS. Web screens: no broken images, no horizontal overflow at 375 and 1280 px; favicons served (200).
  Evidence: `tasks/current/evidence/brand/`. Android (rebuilt dev APK, 75.8 MB, emulator `simplysit_api36`): launcher icon,
  splash (olive monogram on #F5F1E5), lockup above the venue list and monogram on the sign-in card all confirmed
  (`android-1-launcher.png` ... `android-4-account.png`). iOS icon/splash: NOT RUN (no access).
- Contrast: logo olive on canvas 10.91:1; logo cream on header 6.49:1; header tagline (sand on primary) 4.78:1.
- Open (D08): vector or >=1024 px masters (monogram is 300x433, icons are upscaled), logo/UI font licence, rights
  confirmation; the lockup's tagline rules are pure black; logo olive differs from UI token `brand.primary` - tokens unchanged.
- Native note: `expo prebuild` now recreates `android/` by default and failed with EBUSY (folder locked); `--no-clean`
  applied the changes in place.

## How to run

```
cd C:\Users\abhin\Desktop\Simply_Sit\build-kit
pnpm install --frozen-lockfile
pnpm db:start            # local stack on 544xx ports (8 containers)
pnpm db:reset            # migrations + synthetic seed, LOCAL only
pnpm env:local           # writes git-ignored .env.local files from `supabase status`
pnpm dev:web             # http://localhost:3000 ; sign in at /sign-in, read codes at http://127.0.0.1:54424 (Mailpit)
pnpm dev:worker          # outbox worker (WORKER_TICK_MS, WORKER_LEASE_SECONDS optional)
pnpm test:integration    # real PostgreSQL
pnpm test:e2e            # builds must exist: pnpm --filter @simply-sit/web build
```

Fixture sign-in: any `*@example.test` fixture (e.g. `manager.cafe@example.test`) or a new email; the code arrives in
Mailpit. Portal pages then ask for an authenticator (any TOTP app; the setup page shows the key).

## Checks run and results

Final sequence on 26 October 2026, after the last code change (one run, in this order):

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm secrets:check` | PASS (`.env.local` files and `apps/mobile/android/` confirmed git-ignored) |
| `pnpm lint` | PASS (client boundary now also blocks `@simply-sit/db`) |
| `pnpm typecheck` | PASS - 10 workspace projects |
| `pnpm test:unit` | PASS - 10 files, 50 tests |
| `pnpm db:reset` | PASS - 9 migrations + seed from empty; buckets created |
| `pnpm test:integration` | PASS - 7 files, 59 tests on real PostgreSQL |
| `pnpm build` | PASS - Next.js build (25 routes + proxy); worker bundle 832.4 kB |
| `pnpm test:e2e` | PASS - 14 tests (OTP via Mailpit, TOTP, bearer API, smoke) |
| `pnpm test:mobile` | PASS - Android and iOS Hermes bundle export |
| `expo install --check` | PASS - dependencies up to date |

Also run during the milestone:
- `pnpm demo:worker-crash` - PASS: worker A leased a 12 s job and was hard-killed; job stayed LEASED with no effect; worker B
  re-leased it after the 10 s lease expired; final `DONE`, attempts 2, exactly one effect (worker B).
- Worker processed real queue work: 15 hold-expiry jobs -> 15 EMAIL notifications SENT via the mock provider; the deletion
  request moved to NEEDS_REVIEW; only the 2 test-induced dead letters remain DEAD.
- SQL smoke as anon/customer/staff (RLS denial, FORBIDDEN staff closure, direct write denied).

What the integration tests prove (docs/08 M2 gate):
- Concurrency: 10 simultaneous holds on one table/time -> exactly 1 winner, 9 SLOT_UNAVAILABLE, 1 active claim; different
  tables do not conflict; a directly inserted overlapping claim fails with 23P01 (constraint holds even without the functions).
- Buffer: 10:00-11:00 blocks 11:00 (cleaning to 11:10); 11:30 allowed; 11:10 rejected as off-grid.
- Expiry: a due hold is expired inside the next hold's lock path (slot resold, old booking EXPIRED, claim inactive, one
  `booking.hold_expired` job) and by the worker sweep running as `simply_worker`.
- Time: 10:00 IST = 04:30Z; grid, min/max/increment, lead, horizon, closing time incl. buffer, overnight 17:00-01:00 period,
  closed Sunday, overlapping-period rejection including Saturday->Sunday wrap.
- Snapshots: booking keeps its accepted policy after the venue publishes v2; stale quote -> QUOTE_CHANGED; policy hash is
  computed in the database; published policy, booking price/identity/time, approved fee config, historical rates, events are
  immutable even for the privileged connection; HOLD -> COMPLETED rejected.
- Isolation: RLS forced on every table; no client write privilege on any table/column; no `app.*` function executable by
  PUBLIC; anon sees only published venues; customer B and other-venue staff see nothing of A's booking/claims/events;
  check-in token hash, provider account ref and staff notes never granted; membership revocation takes effect immediately;
  staff FORBIDDEN / outsider NOT_FOUND / manager needs aal2 for closures; superadmin grant needs aal2 and is audited;
  private bucket owner-only; REST gateway does not expose `app.*` and refuses anon booking reads.
- Outbox: idempotent enqueue; SKIP LOCKED with an uncommitted lease gives no double lease; expired lease recovered, stale
  worker cannot complete; retry backoff then DEAD; non-retryable -> DEAD; handlers idempotent; worker role has no table access.
- Consistency: seeded policies equal `POLICY_PROPOSED_2026_10_25`; DB and `packages/domain` prices agree for every synthetic
  table at 60/90/150/240 minutes; half-up rounding.

## Native evidence (separate)

Android development build, 26 October 2026, emulator `simplysit_api36` (Android 36 Google APIs x86_64, Pixel 7 profile):

| Item | Evidence | Status |
| --- | --- | --- |
| Debug APK with expo-secure-store | `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`, 72.5 MB, `com.simplysit.customer.dev`, "Simply Sit (Dev)", x86_64, debug-signed; manifest carries `secure_store_backup_rules` / `secure_store_data_extraction_rules` | BUILT |
| Venues from the database through the API | `adb reverse` 3000/8081/54421; list shows DB-only venues (brewery, Cafe BTM); brewery detail opens (`evidence/m2/android-1-list.png`, `android-db-venue.png`) | PASS |
| Sign-in with emailed code | `customer.a@example.test`: code requested on device, read from Mailpit, verified via SDK; `/api/v1/me` over bearer shows ACTIVE (`android-2-code.png`, `android-3-signed-in.png`) | PASS |
| Session survives app kill | force-stop + relaunch -> still signed in (secure-store restore) (`android-5-after-restart.png`) | PASS |
| Sign-out revokes and clears | UI signed out; `auth.sessions` for the user 1 -> 0; relaunch still signed out (`android-6-signed-out.png`) | PASS |
| New account + terms at sign-in | fresh `native4.*@example.test`: terms recorded `draft-terms-2026-10-26`, no stale "Accept terms" (`android-12-signed-in-terms.png`) | PASS after fix (see below) |
| Terms accepted after sign-in | fresh `native2.*`: "Accept current terms" button -> recorded, button gone | PASS |
| Deletion request | fresh `native.*`: confirmation dialog -> DELETION_PENDING + DELETE request REQUESTED (`android-8-delete-confirm.png`, `android-9-deletion-pending.png`) | PASS |
| Revoked session (permission denied) | sessions deleted server-side; relaunch -> `/me` 401 -> local sign-out, "Your session ended. Please sign in again." (`android-13-revoked.png`) | PASS |
| Physical Android device | none attached | NOT RUN |
| iOS build / Keychain / sign-in | Windows host, no macOS/iPhone/EAS access | **NOT RUN - no access** |

Defect found on device and fixed: after accepting terms during native sign-in the account screen showed a stale "Accept
current terms" button, because the session listener loaded `/me` before the terms call finished. `account.tsx` now reloads
`/me` after acceptance; re-verified on the emulator with a new account.

Web screens (375 px) from the database-backed build: `evidence/m2/web-home-db.png`, `web-venue-db.png`, `web-sign-in.png`.

## M2 re-verification (26 October 2026, evening)

Ran the M2 prompt again against the repository. Handoff claims matched the files (9 migrations, 16 API routes, all listed
scripts/tests present); the table count was wrong (24 -> 25, corrected). Two gaps were closed:

- **Session recovery (web)** - new `apps/web/e2e/session.spec.ts`: (1) a stored session marked expired is refreshed by
  `proxy.ts` with the refresh token (new access and refresh tokens, cookies still httpOnly, API 200); (2) a session revoked
  at the Auth server -> `/api/v1/me` 401 and `/account` redirects to sign-in; (3) a forged `aal2` access token in the
  cookie is never trusted. Sign-in helper moved to `e2e/helpers.ts`.
- **Query plans** - new `scripts/query-plans.sql` (`pnpm db:plans`; loads 100 venues / 1,010 tables / 50,000 bookings /
  20,000 jobs in a rolled-back transaction). Found: RLS policies calling `app.my_profile_id()`/`app.is_venue_member()` per
  row forced a sequential scan - **1,001 ms** for one customer's bookings (over the TRD 1 s p95 target). Fixed by
  `supabase/migrations/20261026001000_rls_initplans.sql`: identity resolved once per statement (`app.my_venue_ids`,
  `app.visible_venue_ids`, `(select ...)` InitPlans); same access rules. After: BitmapOr on the customer and venue
  indexes, **1.1 ms**. Overlap check (GiST exclusion index), due-hold sweep and outbox lease were already index-backed.
  Regression test in `rls.test.ts` (with `enable_seqscan = off` the bookings/claims plans must not be Seq Scans).

Re-verification sequence (one run): install --frozen-lockfile PASS; secrets PASS; lint PASS; typecheck PASS (10);
unit PASS (10 files, 51); `db:reset` PASS (10 migrations + seed from empty); `db:plans` PASS (no Seq Scan on hot
queries); build PASS; e2e PASS (**17** tests); test:mobile PASS (Android + iOS export); expo check PASS.
`test:integration` first FAILED 1/60 (outbox backoff test: `LEASE_LOST`). Cause: an orphaned local `pnpm dev:worker`
(stopping the background task killed pnpm but not its `tsx` child) leased the test's job - shown by its live heartbeat
and 11 completed jobs. Stopped it; rerun PASS **60/60**. `outbox.test.ts` now refuses to run while a worker heartbeat is
live, with a clear message.

## Not verified

- iOS build, Keychain storage, iOS sign-in: NOT RUN (no access).
- Physical Android device: NOT RUN.
- Deletion fulfilment (anonymisation, Auth identity removal) is not implemented; requests reach NEEDS_REVIEW (M4/M5 with
  owner/legal retention decisions D09).
- Upgrade path from a previous schema: N/A (first migration set; nothing previously shipped). Recorded per docs/06 M2.1.
- Query plans beyond the pilot volume in `scripts/query-plans.sql` (100 venues, 1,010 tables, 50,000 bookings) and real
  concurrent load (TRD T21) are not measured.
- The ESLint client boundary does not cover web `"use client"` modules (only mobile and client packages).
- Rate limiting is per process (in memory).
- Independent review (REVIEW.md).

## Unresolved issues and owners

- iOS access - product owner.
- UI/UX references (Figma + Google Stitch, 26 Oct) recorded in `docs/04` s.1. Only Figma's low-resolution overview preview
  could be retrieved (`references/ui/figma-overview-thumbnail.png`: ~9 mobile + ~8 desktop/portal screens, orange accent not
  in tokens). Owner to share full-size exports (PNG@2x/PDF per frame; Stitch export) into `references/ui/`, or authorize the
  Figma connector. Current screens follow docs/04 until then.
- Project git repository - product owner (nothing committed; the enclosing repo is the home directory).
- Proposed policies in code (decision register): staff/manager MFA requirement, email OTP, 10-minute code expiry, draft
  terms versions `draft-terms-2026-10-26`, 15-minute recent-verification window for deletion requests. Owner/legal review.
- D02-D10 still open; SANDBOX-ZERO fee configuration must never be used for real money.
- Machine load: other projects' processes occasionally consumed most CPU/RAM; Android builds need ~3 GB free.

## Machine state left behind

- Running: this project's local Supabase stack (8 containers on 544xx; stop with `pnpm exec supabase stop` from build-kit).
  The other local project (`Djain`) was never touched.
- Stopped: web servers, Metro, worker, emulator, Gradle daemons.
- Local database contains test-created fictional venues/users (`test-venue-*`, `e2e.*@example.test`, `native*.*@example.test`);
  `pnpm db:reset` returns it to the seed.

## Rollback

Delete the nine migration files and run `pnpm db:reset` to return to the M1 empty schema; application changes are additive
except `/api/v1/venues` (now database-backed), the error envelope (snake_case) and the account/portal pages.

## Next concrete task

M3.1/M3.2 (see docs/06): discovery API per docs/07 `GET /venues` with area/time/party/filters and availability, using the
existing `app.create_quote`/`app.create_booking_hold`; then M3.3 checkout with the mock payment adapter. Before M3 money
work, obtain the independent review of M2 (REVIEW.md list).
