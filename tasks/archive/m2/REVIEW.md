# M2 review checkpoint (data, authentication, authorization, inventory, async)

Reviewed revision: working tree on 26 October 2026 (no git repository/commits exist; see HANDOFF).

## Independent review - performed 26 October 2026 (evening)

Reviewer: a fresh Claude Code session (Opus 5.5) with no authoring context from M2, working read-only from the files, the
specs (docs/02, 05, 07, 08) and the running local database. It is independent of the M2 author's context. It is **not**
a human or different-vendor review; docs/06 M5.1 still calls for human technical review of money/inventory code before
any live use.

Scope read in full: migrations `000100`-`001000`, `seed.sql`, `packages/db/src/{index,domain}.ts`,
`apps/web/lib/{api,me,portal,rate-limit,venues}.ts`, `apps/web/lib/auth/*`, `apps/web/proxy.ts`, all `/api/v1` routes,
`apps/worker/src/*`, `packages/contracts`, `packages/providers`, `tests/integration/helpers.ts`. Not re-read line by line:
mobile screens, web pages, the integration test bodies (their results are in HANDOFF).

### What holds (checked against the code)

- Lock order venue -> resource (sorted) -> booking is the same in `create_booking_hold`, `cancel_hold`, `create_closure`
  and `expire_due_holds`; the deadline clock is `clock_timestamp()` sampled after the locks; due holds are expired inside
  the lock path before the overlap check; `no_active_overlap` is the last line of defence and maps to `SLOT_UNAVAILABLE`.
- The `001000` policy rewrite is semantically equal to `000900` for every table (checked each policy pair, including the
  RLS-filtered sub-selects in `resource_rates`, `partners` and `booking_events`). It also fixes a latent `000900` bug: in
  `partners_read` the unqualified `id` inside `exists (select ... from venues v where v.partner_id = id ...)` resolved
  to `v.id`, so managers could never read their partner row. `001000` replaced the policy, so no action is needed.
- Writes only through `app.*` SECURITY DEFINER functions with `search_path = ''`; PUBLIC EXECUTE revoked; `app` is not in
  PostgREST `api.schemas`.
- Server identity: cookie XOR bearer; `auth.getUser` before claims are decoded; claims bound as a parameter in
  `SET LOCAL ROLE` transactions. Origin check on cookie writes; bearer calls exempt (no ambient credentials).
- Idempotency begin/complete share the domain transaction, so a failed write leaves no record and a concurrent
  duplicate waits on the unique index, then replays.

### Findings

| # | Severity | Location | Finding | Impact | Reproduction | Smallest fix |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | Medium | `supabase/migrations/20261026001000_rls_initplans.sql:116-132` (`bookings_read`, `booking_events_read`) and `000900` column grant on `public.bookings` | Any ACTIVE venue member, including STAFF and including an **aal1** (email-code-only, no TOTP) session, can read every column granted on `bookings` for the venue through the REST gateway: `price_snapshot` (incl. `commission_bps`), `total_paise`, `customer_id`, `policy_snapshot`. MFA for staff is enforced only by the web portal pages, not by RLS. docs/05 matrix: staff get "scoped minimal operational" data; docs/02 s.5: staff never see full financial records. | A stolen email-code session of a staff member reads the venue's booking amounts and pseudonymous customer IDs (no contact data). | As `staff.cafe@example.test` with `aal1` claims: `select price_snapshot->>'commission_bps', customer_id from public.bookings` returns rows (run on 26 Oct, 1 row). | Venue-member RLS reads require `aal2`; booking/event table reads for venue members limited to MANAGER/OWNER; staff operational reads go through a column-minimal SECURITY DEFINER function. **Fixed in M3** (`20261026001100_m2_review_fixes.sql`). |
| R2 | Low | `20261026000700_inventory_functions.sql:263-266` | `create_booking_hold` accepts any non-null `terms_version`; it does not compare with `app.current_terms_version()`. The API's `terms_required` flag does compare, so this is defence-in-depth only. | After a terms change, an old-terms account could hold inventory through a direct function path. | Set a profile's `terms_version` to `old`; hold succeeds. | Compare with the current version in the function. **Fixed in M3.** |
| R3 | Low | `20261026000700_inventory_functions.sql:351-386` | `cancel_hold` records `from_status = 'HOLD'` even when the booking was `PENDING_PAYMENT`, and cancels a hold whose deadline has already passed instead of expiring it first in the lock path. | Event history slightly wrong; a due hold is recorded as customer-cancelled instead of expired. | Cancel a PENDING_PAYMENT booking; event shows HOLD -> CANCELLED. | Expire due holds in the lock path; record the real previous status. **Fixed in M3** (cancel now also handles payment orders). |
| R4 | Low | `apps/web/app/api/v1/auth/sign-out/route.ts:14-16` | Native (bearer) sign-out ignores the Auth server's logout response; a failed revocation still returns 204. | The client clears its secure store, but the refresh token can stay valid server-side if the Auth call failed. | Stop the Auth container, sign out from the app: 204. | Return 503 `DEPENDENCY_UNAVAILABLE` when logout fails (client still clears locally). **Fixed in M3.** |
| R5 | Low | `20261026000800_account_jobs_functions.sql:108-142` | `admin_grant_venue_membership` lets an unknown venue/profile ID reach the FK and surface as 500 `INTERNAL_ERROR` instead of 404. | Misleading error for an admin. | Grant on a random venue UUID. | Check existence first and raise `NOT_FOUND`. Deferred (M4 partner/admin work). |
| R6 | Low | `000900` grant on `public.resources` | `operational_state` (READY/OCCUPIED/CLEANING) is readable by anon for published venues. | Leaks live occupancy of each table; not personal data. | `select operational_state from resources` as anon. | Decide with owner whether live readiness is public; otherwise drop the column from the anon grant. Deferred, recorded. |
| R7 | Info | `apps/web/lib/api.ts:37` | Body limit counts UTF-16 characters, not bytes. | A multibyte body up to ~3x the limit is accepted. | n/a | Use `Buffer.byteLength`. Deferred. |
| R8 | Info | `create_quote` | Quotes are unthrottled; a signed-in client can create unlimited quote rows. | Table growth / mild abuse. | n/a | Per-user rate limit before pilot (M5 load work). Deferred. |

No critical or high findings. R1-R4 were fixed with regression tests during M3 (see `tasks/current/HANDOFF.md`).

## Review list prepared by the M2 author (kept for reference)

1. `supabase/migrations/20261026000700_inventory_functions.sql` - `app.create_booking_hold`: lock order (venue -> resource ->
   quote), clock sampled after locks, in-lock expiry, exclusion violation mapped to SLOT_UNAVAILABLE; `app.create_closure`
   conflict detection and role/MFA checks; `app.expire_due_holds` sorted locking.
2. `supabase/migrations/20261026001000_rls_initplans.sql` replaces every read policy from `000900` with an equivalent that
   resolves identity once per statement.
3. `supabase/migrations/20261026000600_auth_helpers.sql` - profile resolution through `profiles.auth_user_id`, membership
   re-read per call, `app.require_aal2` reading `aal` from request claims.
4. `packages/db/src/index.ts` - `inRole`: SET LOCAL ROLE + `request.jwt.claims` from verified claims only.
5. `apps/web/lib/auth/identity.ts` - cookie XOR bearer, `auth.getUser` before trusting any claim, `decodeClaims` scope.
6. `apps/web/lib/api.ts` - origin check exemption for bearer calls; redirect allowlist; idempotency hash/route scope.
7. `supabase/migrations/20261026000800_account_jobs_functions.sql` - `app.request_privacy` recent-verification check from
   `amr`; outbox lease/complete/fail semantics; `app.admin_grant_venue_membership`.

## Findings by the author during M2 (fixed, with regression tests)

- PostgreSQL grants EXECUTE on new functions to PUBLIC; fixed with an explicit revoke; `rls.test.ts` enforces it.
- M1 synthetic fixture advertised the cafe "from" price as the first table rather than the cheapest one; fixed.

## Known limits a reviewer should weigh (from the author, still true)

- Server DB connection is the local `postgres` role (BYPASSRLS) that downgrades per request with SET LOCAL ROLE. A
  dedicated least-privilege login role is required before any shared environment (M5/M6).
- `app.*` SECURITY DEFINER functions trust `request.jwt.claims`; keep `app` unexposed.
- OTP/MFA rate limits are per process.
- Staff/manager portal access requires aal2 (TOTP) - a proposed policy to confirm with the owner.
- iOS session storage and sign-in NOT RUN (no macOS/iPhone access).
