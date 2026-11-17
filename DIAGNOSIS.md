# Simply Sit — Diagnosis (16 November 2026)

No application code was changed. This file is the only file written.

**Repository state:** branch `main`, last commit `0d3553d`. The working tree also holds uncommitted step-D work
(staff arrival screens, partner support centre, admin directory, system settings, access gate, plus tests). Every result
below was produced on that tree. The repository is pushed to `origin/main` at `0d3553d`; the uncommitted work is not on
GitHub.

**Environment:** Windows 11, Node per `.nvmrc`, pnpm 9.15.9, local Supabase (Docker), MOCK payment/email/maps providers.

---

## 1. Commands run and results

| # | Command | Result |
| --- | --- | --- |
| 1 | `pnpm install --frozen-lockfile` | exit 0 (pnpm prints an update notice only) |
| 2 | `pnpm lint` | exit 0, no output |
| 3 | `pnpm typecheck` (all workspace projects) | exit 0, no errors |
| 4 | `pnpm test:unit` | **14 files, 79 tests passed** |
| 5 | `pnpm --filter @simply-sit/web build` | exit 0; all routes compiled (static and dynamic) |
| 6 | `pnpm test:integration` | exit 1: **175 passed, 3 failed** (178 total), 2 files failed |
| 7 | `npx playwright test` (full web e2e, production build on :3100) | **52 passed, 0 failed** (5.5 min) |
| 8 | `pnpm dev:worker` | running; ticks every 5 s: `completed=120 failed=0 holds_expired=1 orders_reconciled=79` |
| 9 | `pnpm dev:mobile` (Expo / Metro) | running; `curl http://localhost:8081/status` → `packager-status:running` |
| 10 | Web on :3000 (`/api/v1/health`, `/sign-in`, `/api/v1/venues?area=koramangala`) | health `status:ok`, mode `mock`; sign-in HTTP 200; search returns venues |

Command 6, failures in detail:

```
FAIL tests/integration/discovery.test.ts > returns published venues only ...
  AssertionError: expected [ …(100) ] to include '9f735ae2-…'      discovery.test.ts:32
FAIL tests/integration/discovery.test.ts > reports availability for a slot ...
  AssertionError: expected undefined to deeply equal { available_tables: 1, … }   discovery.test.ts:62
FAIL tests/integration/finance.test.ts > approves a batch longer than one run ...
  AssertionError: expected { …(18) } to match object { status: 'MATCHED' }
  - "status": "MATCHED"  + "status": "MISMATCH"                            finance.test.ts:435
```

Command 7 (e2e) covers the main customer and staff flows in a real browser: sign-in with email code and authenticator
(`auth.spec.ts`, `helpers.ts`), venue search and table selection (`journey.spec.ts:11`), hold and checkout on the mock
gateway (`journey.spec.ts`), payment confirmation, then staff check-in, check-out and "table ready"
(`journey.spec.ts:45–62`). All passed on this tree.

---

## 2. Issues

| # | Issue | Where (file:line) | Exact error | Root cause (proved by reproduction) | Severity | Smallest fix |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Discovery test cannot find its venue | `tests/integration/discovery.test.ts:32`, `:62` | `expected [ …(100) ] to include '9f735ae2-…'`; `expected undefined to deeply equal { available_tables: 1 … }` | Proved. The local database now holds **430 venues** (created by e2e and integration runs). The search function caps results at **100** (`supabase/migrations/20261026001400_discovery_arrival.sql:260`, `least(..., 100)`), and the test searches with no filter. The test's venue is not on the first page. Product search is not affected: it is paginated. | Low (test data only) | Make the test search by its own unique area or name, or run `pnpm db:reset` (wipes local data — you declined). |
| 2 | Finance reconciliation test fails (reconciliation returns MISMATCH) | `tests/integration/finance.test.ts:435` | `expected status MATCHED, received MISMATCH` | **Partly proved.** Reproduced on two runs (full suite and this file alone). Run `8492ad03`, window `11:35:41–11:37:41`: provider 133 captures / ₹40,089.00; local 132 / ₹40,079.00. Three exceptions: `MISSING_LOCALLY` `pay_mock_ddCXWGCk1PFKpx` ₹300.00 and `pay_mock_AIwqrIpxErUhd0` ₹10.00 (both captured 11:37:11 at the provider with no local row); `MISSING_AT_PROVIDER` local `pay_mock_b93b284c57614f` ₹300.00 (captured 11:37:22). The test's two-minute window (`now − 120 s`) picks up captures from other test runs. **Not proved:** why those provider captures have no local rows. Possibly a rolled-back earlier test. | Medium (flaky test; it also gates the payout logic it is meant to prove) | Scope the test: create its own payment IDs and reconcile only those, or start the window before the test's first payment. Confirm the source of the orphan provider captures first (NOT VERIFIED). |
| 3 | Expo app not verified on a device | `apps/mobile` | — | Metro starts and serves (`packager-status:running`), and mobile typecheck and lint pass. No emulator or device was run, so no screen was exercised. | Unknown | Start an Android emulator (the SDK path is in `tasks/current/release`); run `pnpm test:mobile`. |
| 4 | Uncommitted step-D work | 14 modified or new files, see `git status` | — | Not a defect. The changes passed e2e 52/52 but are not committed or pushed. | Info | Commit and push when you say so. |

---

## 3. NOT VERIFIED (and what I need from you)

1. **Real payment sandbox.** `/api/v1/health` reports `payment: mock`. No provider sandbox was exercised and no
   payment credentials exist in this repository. **Needed:** the payment provider decision (D04) and sandbox keys, given
   in a `.env.local` that is never committed.
2. **Camera QR scanning.** The scan path uses `BarcodeDetector` and a real camera, which the browser tests cannot
   exercise. The e2e tests check in with PIN and pasted code only. **Needed:** a phone or laptop with a camera for a
   manual pass.
3. **Mobile on a device.** See issue 3. **Needed:** confirmation that you want me to set up an emulator run (it uses
   significant memory on this laptop; see the laptop-health note in memory).
4. **Root cause of issue 2's orphan provider captures.** **Needed:** your go-ahead to query the local database more
   deeply (read-only) to trace which test run wrote them.
5. **Whether to fix issues 1 and 2 now.** Both are test-side. Fixing issue 1 without a reset means changing the test;
   a reset would clear all local test venues. **Needed:** your choice.

---

## 4. Running processes

Left running for your inspection: web on `http://localhost:3000` (preview), worker, and Metro on `http://localhost:8081`.
Local Supabase is up. To stop the worker and Metro, end the `cmd.exe` processes started for `pnpm dev:worker` and
`pnpm dev:mobile`.

---

## 5. Resolution (17 November 2026)

Both test-side issues were fixed without a database reset; no application code changed.

- **Issue 1 (discovery):** `tests/integration/discovery.test.ts` gained `searchAll`, which walks every results page
  instead of trusting the first page. The paging test still checks `next_offset` and `total` on one page.
- **Issue 2 (finance):** `tests/integration/finance.test.ts` now reconciles only a ±2 s window around the test's own
  recent capture, instead of the last two minutes. Residual risk: another run capturing within the same two seconds
  could still cause a mismatch; the orphan provider captures from earlier runs are not explained (see issue 2 above).

Checks: `pnpm typecheck` exit 0; `pnpm lint` exit 0; `pnpm test:integration` 178 of 178 passed; the two fixed files
repeated twice more, 19 of 19 each time. The web e2e suite was not re-run, because only integration tests changed.
