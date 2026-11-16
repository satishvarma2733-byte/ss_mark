# M2 implementation plan: data, authentication, authorization, inventory, async

Written 26 October 2026 before M2 edits. M1 records are archived in `tasks/archive/m1/`.
Root: `C:\Users\abhin\Desktop\Simply_Sit\build-kit`. No git commits (no project repository; see HANDOFF).
Specs: `docs/05-BACKEND-SCHEMA.md`, `docs/07-API-AND-STATE-MACHINES.md`, `docs/02-TRD.md` s.4-6, `docs/06` M2, `docs/08` T03-T16/M2 gate, `docs/03` C02/C14.

## Architecture decisions for M2

- **Base tables in `public` with RLS enabled on every table.** All INSERT/UPDATE/DELETE privileges are revoked from `anon` and `authenticated`, including Supabase's default privileges. Clients receive only SELECT, with column lists where a table has unsafe columns. Every write goes through `SECURITY DEFINER` functions in a private `app` schema (`search_path = ''`).
- **`app` is not exposed by PostgREST** (`api.schemas` stays `public, graphql_public`), so the publishable key cannot call mutations directly. The Next.js API is the only mutation entry point.
- **Server DB access** uses `postgres` (postgres.js 3.4.9) on `DATABASE_URL`. Each request runs in one transaction with `SET LOCAL ROLE anon|authenticated` plus `request.jwt.claims` taken from a token the server has already verified. RLS and `auth.uid()` therefore apply to server reads as well. The worker uses `SET LOCAL ROLE simply_worker`, a NOLOGIN role with explicit grants.
- **Identity**: Supabase Auth email OTP (6 digits, 10-minute expiry, 60-second resend) with a custom code template. Web uses `@supabase/ssr` 0.12.7 cookie sessions through `proxy.ts` (Next 16 renamed middleware to proxy). Native uses `@supabase/supabase-js` 2.118.0 with an `expo-secure-store` chunked storage adapter and calls the API with a bearer token. The server verifies every protected request with `auth.getUser(token)`, which also catches revoked sessions.
- **MFA**: TOTP. Database functions for portal-privileged actions require `aal2` from the JWT claims. Web pages `/account/security` (enrol/verify) and portal pages enforce it.
- **Errors**: functions raise a stable domain code as the exception message (e.g. `SLOT_UNAVAILABLE`). The server maps an allowlisted code to HTTP status and safe text (docs/07 s.1); unknown errors return 500 `INTERNAL_ERROR`.
- **Single pricing source**: quote arithmetic runs in the database (`app.create_quote`). A cross-check integration test asserts the database matches `packages/domain` `quoteTable` and that seeded policies equal `PILOT_POLICY`.

## Scope in M2 vs deferred

In: profiles, partners, venue_categories, venues (PostGIS point), venue_memberships, platform_memberships, venue_media, venue_amenities, venue_tags, venue_policies, fee_configurations, resources, resource_rates, opening_periods, quotes, bookings, inventory_claims, booking_events, idempotency_records, outbox_jobs, notifications, privacy_requests, audit_events, worker_heartbeats.

Deferred to the milestone that uses them, with tables created then: extension_requests (M4), payment_orders/attempts, provider_events (M3), refunds, disputes, ledger, payouts, reconciliation (M3/M4), reviews, support_tickets (M4).

## Migrations (`supabase/migrations/`)

| File | Content |
| --- | --- |
| `20261026000100_foundation.sql` | extensions (btree_gist, postgis in `extensions`), `app` schema, roles (`simply_worker`), revoke default privileges, `app.touch_row` trigger (updated_at + version), append-only guard, error helper |
| `20261026000200_identity_catalogue.sql` | profiles (+ auth.users insert trigger), partners, venue_categories (+ seed values), venues, memberships, media, amenities, tags |
| `20261026000300_policies_rates_hours.sql` | venue_policies (immutable once published, content hash), fee_configurations, resources, resource_rates (no overlapping effective ranges), opening_periods (overlap trigger incl. overnight) |
| `20261026000400_bookings_inventory.sql` | quotes, bookings (snapshot immutability trigger), inventory_claims (+ `no_active_overlap` exclusion, finite `[)` checks), booking_events |
| `20261026000500_jobs_support.sql` | idempotency_records, outbox_jobs, notifications, privacy_requests, audit_events, worker_heartbeats |
| `20261026000600_auth_helpers.sql` | `app.current_profile_id`, `app.require_active_profile`, `app.is_venue_member`, `app.has_platform_role`, `app.require_aal2` |
| `20261026000700_inventory_functions.sql` | `app.validate_slot`, `app.create_quote`, `app.create_booking_hold`, `app.cancel_hold`, `app.expire_due_holds`, `app.create_closure` |
| `20261026000800_account_jobs_functions.sql` | `app.accept_terms`, `app.update_my_profile`, `app.request_privacy`, `app.admin_grant_venue_membership`, outbox enqueue/lease/complete/fail, heartbeat, idempotency begin/complete |
| `20261026000900_rls_grants.sql` | RLS on all tables; policies per docs/05 matrix; column grants; function EXECUTE grants; storage bucket policies |

`supabase/seed.sql`: 8 DEMO venues across all six categories, including one overnight brewery, one DRAFT venue and one venue under another partner. It also seeds published policies equal to `PILOT_POLICY`, a SYNTHETIC zero-fee configuration marked approved for sandbox use only, tables, rates and weekly hours, plus fixture auth users (`*@example.test`) with memberships: customers A/B, staff and manager at venue 1, staff at venue 2, and a superadmin.

## Application changes

- `packages/db` (new, server-only): postgres.js client, `withRole`, domain error mapping, typed function wrappers.
- `packages/contracts`: me/profile, quote, hold, closure and privacy contracts; hourly pricing basis.
- `apps/web`: `proxy.ts`, `lib/auth/*` (SSR client, request identity: cookie XOR bearer, origin check, redirect allowlist), API routes `auth/otp/request|verify`, `auth/sign-out`, `me`, `me/terms`, `privacy-requests`, `quotes`, `booking-holds`, `partner/bookings`, `partner/resources/[id]/closures`, `admin/metrics`; pages `/sign-in`, `/account`, `/account/security`, portal gating. `/api/v1/venues` reads published venues from the database.
- `apps/worker`: real loop (expire holds, lease/dispatch jobs, heartbeat), handlers for `booking.hold_expired`, `privacy.delete_requested`, `notification.email` (MockEmailProvider), `diagnostic.sleep` (development only, for the crash demo).
- `apps/mobile`: Supabase client with chunked SecureStore adapter, Account tab sign-in/out/terms/deletion request, bearer API client. Requires a dev-client rebuild (adds the expo-secure-store native module).

## Tests and checks (completion criteria)

1. `pnpm db:reset` applies all migrations and seed from empty (exit 0). Upgrade path: no previously shipped schema exists, so it is N/A for this first migration set; recorded as such.
2. Integration (`tests/integration`, real PostgreSQL):
   - RLS enabled on every public table; anon/authenticated have no write privileges anywhere.
   - Cross-tenant: customer B cannot read A's bookings; venue-2 staff cannot read venue-1 bookings or claims; anon cannot read draft venues or private columns.
   - Roles: staff cannot create closures and the manager can; superadmin grant requires `aal2`.
   - Inventory: 10 concurrent holds on one slot give exactly 1 winner; buffer adjacency conflicts; different tables do not conflict; a direct overlapping claim insert raises `23P01`; an expired hold is released in the lock path and by sweep; a closure over a held booking is rejected with refs and a closure blocks later holds.
   - Time: IST boundaries, grid, lead, horizon, outside hours including buffer, overnight brewery period.
   - Snapshots: booking snapshot unchanged after a new policy is published; snapshot update raises; published policy update raises.
   - Pricing: DB quote equals TS `quoteTable`; seeded policy equals `PILOT_POLICY`.
   - Outbox: idempotent enqueue; SKIP LOCKED gives no double lease; lease expiry recovery; backoff then DEAD; a stale worker cannot complete a job.
3. Web e2e (Playwright): OTP sign-in through the Mailpit API, account page, sign-out, redirect allowlist, portal denied without membership, TOTP enrolment, staff access, API bearer cross-tenant 404, staff closure 403, manager closure 201.
4. Worker crash demo: kill the worker during `diagnostic.sleep`; after lease expiry a second worker completes it exactly once.
5. Android: dev-client rebuild; sign-in with emailed code on the emulator, `/me` shown, sign-out clears secure store; screenshots.
6. lint, typecheck, unit, integration, build, e2e, test:mobile, secrets check.

## Risks

- Machine load: other projects' processes leave about 1 GB of RAM free, so builds are slow. Android rebuild may need services stopped first.
- The local connection is the `postgres` role; every request downgrades with `SET LOCAL ROLE`. A dedicated least-privilege login role is an M5/M6 production item.
- In-memory API rate limiting is per process; a shared limiter is needed before multi-instance deployment.

## Rollback

Migrations are new files; remove them and run `pnpm db:reset` to return to the M1 empty schema. Application changes are additive except `/api/v1/venues` (now database-backed) and the contracts pricing basis.
