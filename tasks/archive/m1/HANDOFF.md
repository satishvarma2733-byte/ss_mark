# Current handoff - Milestone 1 (local project foundation)

Dates: 25-26 October 2026. Root: `C:\Users\abhin\Desktop\Simply_Sit\build-kit`.
Objective: M1 from `docs/06-IMPLEMENTATION-PLAN.md` - runnable local monorepo for customer web, Android/iOS customer app, partner/staff/admin web shells, worker and shared contracts, with synthetic data and simulated providers only.
Plan: `tasks/current/PLAN.md` (includes the gap-closure slice). Review status: `tasks/current/REVIEW.md`.

## Status

M1 is complete for everything that can run on this Windows machine:

- Customer web, partner/staff/admin web shells, API, worker, contracts, design tokens, versioned policy, simulated providers, environment validation and local Supabase: built and checked.
- **Android: development build compiled, installed and run on an emulator; six native screens inspected.**
- **iOS: NOT RUN - no access.** Windows cannot build or run iOS. Owner: product owner. Resolution path: (a) an EAS iOS development build under the organisation's Expo and Apple developer accounts (needs their login and authorisation), or (b) a macOS runner with Xcode plus an iPhone. Required before any M3 parity claim.
- Staging web preview: NOT RUN - needs an owner-controlled hosting account.
- CI workflow: written, NOT RUN - needs a GitHub remote.
- Independent review: not performed (see REVIEW.md).

## Kickoff-prompt audit (26 October)

An audit of `prompts/00-START-HERE.md` against the first M1 pass found gaps. They were closed in this pass:

| Gap | Now |
| --- | --- |
| PRD not read, TRD partly read | Both read in full; three extra M1 requirements found and implemented (below) |
| No simulated providers | `packages/providers` mocks for payment, email, maps |
| No environment validation | Fail-closed schema used by web (`instrumentation.ts`) and worker |
| Policy hard-coded | `packages/domain/src/policy.ts`, versioned and frozen |
| Mobile imported server-only domain code | Removed; ESLint now blocks it |
| One bundle ID for all profiles | `app.config.ts`: development and preview IDs and URL schemes |
| No staging template | `config/.env.staging.example` |
| No Android development build | Built, installed and run on emulator |

## What changed

First pass (25 October): workspace root, `packages/{design-tokens,contracts,domain,synthetic-data,api-client}`, `apps/{web,mobile,worker}`, `supabase/`, `tests/integration`, `scripts/check-secrets.mjs`, `.github/workflows/ci.yml`. Details are in PLAN.md.

Gap-closure pass (25-26 October):

- `packages/domain/src/policy.ts` (new): proposed pilot policy `proposed-2026-10-25` (60-240 min, 30-min steps, 15-min lead, 30-day horizon, 5-min hold, 10-min cleaning, 15-min grace, 10-min reminder, 120-min full-refund cutoff). Unknown versions throw. `quote.ts` reads it and returns `policyVersion`.
- `packages/providers/` (new, server-only): `MockPaymentProvider` (deterministic order per hold; a different amount for the same hold is refused; statuses captured/failed/pending/unknown), `MockEmailProvider` (dedupes by idempotency key, never sends), `MockMapsProvider` (synthetic localities only), `loadServerEnv` (only `mock` modes accepted; rejects secret-like `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*` variables without echoing values), `createProviders`.
- `apps/web/instrumentation.ts`, `apps/web/lib/server-env.ts` (new): web refuses to start with invalid configuration. `/api/v1/health` now reports provider modes and policy version (contract updated). The venue page shows the policy version.
- `apps/worker/src/index.ts`: uses `loadServerEnv`.
- `apps/mobile/app/venue/[id].tsx`: shows the listed price only. Totals are server-quoted.
- `eslint.config.mjs`: `no-restricted-imports` blocks `@simply-sit/domain` and `@simply-sit/providers` in mobile and client packages. Also ignores generated `android/` and `ios/`.
- `apps/mobile/app.config.ts` (new) + `app.json` (identity fields moved out) + `eas.json` (`APP_VARIANT` per profile): development `com.simplysit.customer.dev` / `simplysit-dev`, preview `com.simplysit.customer.preview` / `simplysit-preview`. Production fails closed.
- `apps/mobile/react-native.config.js` (new): excludes `react-native-reanimated`, `react-native-worklets` and `react-native-gesture-handler` from native autolinking. They are present only as auto-installed peers of an unused drawer package. The exported JavaScript bundle was checked and does not import them.
- `apps/mobile/app/(tabs)/_layout.tsx`: tab icons (`@expo/vector-icons`). Previously the tabs showed missing-glyph boxes, found on the emulator.
- `apps/mobile/app/(tabs)/account.tsx`: body title "Not signed in" (avoids repeating the header). Changed after the Account screenshot was taken.
- `apps/mobile/package.json`: added `expo-dev-client ~58.0.15` and `@expo/vector-icons ^15.0.2` via `expo install`; removed `@simply-sit/domain`. `expo prebuild` changed the `android`/`ios` scripts to `expo run:android` / `expo run:ios`.
- `packages/synthetic-data`: the three venues now show all three food modes (cafe allowed, lounge prohibited, workspace restricted). The lounge was previously mislabelled `restricted` with a "not permitted" note.
- `config/.env.staging.example` (new), `config/.env.example` (+`MAPS_PROVIDER`), `.gitignore` (+`!.env.*.example`, +`apps/mobile/android/`, +`apps/mobile/ios/`), `scripts/check-secrets.mjs` (skips generated `build`, `.gradle`, `.cxx`).
- `tasks/current/evidence/m1/`: screenshots (below).

## How to run

Prerequisites on this machine: Node 24.14.0, pnpm 9.15.9, Docker Desktop, Java 17, Android SDK at `%LOCALAPPDATA%\Android\Sdk`.

```
cd C:\Users\abhin\Desktop\Simply_Sit\build-kit
pnpm install --frozen-lockfile
pnpm dev:web          # http://localhost:3000 (APP_MODE=live is refused)
pnpm dev:worker       # mock heartbeat; APP_MODE=live is refused
pnpm db:start         # local Supabase: API 127.0.0.1:54421, Postgres 54422, Studio 54423
pnpm db:reset         # rebuild LOCAL database from migrations + synthetic seed
pnpm dev:mobile       # Metro on :8081 for the development build
```

Android development build (first build about 17 minutes; later builds are incremental):

```
cd apps\mobile
set APP_VARIANT=development
npx expo prebuild --platform android --no-install      # generates android/ (git-ignored)
# Windows path-length workaround, required after every prebuild --clean:
#   android\local.properties:
#     sdk.dir=C:/Users/abhin/AppData/Local/Android/Sdk
#     cmake.dir=C:/Users/abhin/AppData/Local/Android/Sdk/cmake/3.31.6
cd android && gradlew assembleDebug -PreactNativeArchitectures=x86_64
adb install -r app\build\outputs\apk\debug\app-debug.apk
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW -d "simplysit-dev://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" com.simplysit.customer.dev
```

Emulator: AVD `simplysit_api36` (Pixel 7 profile, Android 36 Google APIs x86_64, WHPX acceleration). Start with `%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe -avd simplysit_api36`.

## Checks run and results

Final sequence on 26 October after all code changes (lint, typecheck and test:mobile were rerun after the last mobile edits):

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm secrets:check` | PASS |
| `pnpm lint` | PASS (rerun after final mobile edits) |
| `pnpm typecheck` | PASS - 9 projects (rerun after fixing a tab-icon colour type error found in the first final run) |
| `pnpm test:unit` | PASS - 8 files, 37 tests (policy, providers, env validation added) |
| `pnpm test:integration` | PASS - 1 test, 2 todo (M2 PostgreSQL items) |
| `pnpm build` | PASS - Next.js production build; worker bundle 741.8 kB (now includes zod) |
| `pnpm test:e2e` | PASS - 4 Playwright tests, including health reporting mock providers and policy version |
| `pnpm test:mobile` | PASS - Android and iOS Hermes bundle export (rerun after final mobile edits) |
| `expo install --check` | PASS - dependencies up to date |
| ESLint boundary probe | PASS - importing `@simply-sit/domain` from `apps/mobile` is rejected |
| `expo config` per variant | PASS - distinct names, IDs and schemes; `APP_VARIANT=production` fails |
| `APP_MODE=live next start` | Refused: process exits 1 with the validation message. Next prints "Ready" before `register()` completes, then exits |
| `APP_MODE=live` worker | Refused: exits 1 with the validation message |
| `pnpm db:start` / `db:reset` | PASS on 25 October (ports 54420-54429 because another local Supabase project holds the defaults). The stack was stopped on 26 October to free memory for the Android build; restart with `pnpm db:start` |

## Native evidence (separate)

| Platform | Evidence | Status |
| --- | --- | --- |
| Android development build | `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` - 72.3 MB, package `com.simplysit.customer.dev`, label "Simply Sit (Dev)", versionName 0.1.0, x86_64 only, debug-signed. Gradle 9.4.1, CMake 3.31.6, NDK 27.1 | BUILT |
| Android emulator run | `simplysit_api36`: install Success; dev client opened Metro bundle (1,383 modules); Expo runtime `exposdk:58.0.0` | RAN |
| Android screens inspected | `tasks/current/evidence/m1/android-1-launch.png` (dev menu + list), `-2-list.png`, `-3-venue.png`, `-4-error.png` (Metro started with unreachable `EXPO_PUBLIC_API_URL`), `-5-bookings.png` (empty state), `-6-account.png` (old title) | PASS: banner visible, brand colours, no clipped text, system Back returns from venue to list, tabs switch |
| Android physical device | None attached | NOT RUN |
| Android release/signed build | Needs organisation signing (M6) | NOT RUN |
| Android API-backed list | Native app loading venues from the running web API (`EXPO_PUBLIC_API_URL` + `adb reverse tcp:3000`) | NOT RUN (synthetic fallback and error path were run) |
| iOS bundle | Hermes export | COMPILED |
| iOS build, simulator or device | Windows host; no Xcode, macOS runner, iPhone or EAS authorisation | **NOT RUN - no access** |

Android build problems solved on the way (all environment-specific, recorded so they are not rediscovered):

1. The Gradle wrapper download timed out in Java while curl succeeded. Fixed by downloading `gradle-9.4.1-bin.zip` with curl into the wrapper cache after checking the official SHA-256 (`2ab2958f...ec6cb`, match).
2. CMake/ninja failed with "No such file or directory" on 280+ character object paths. Windows LongPathsEnabled is already 1, but SDK CMake 3.22.1 ships ninja 1.10.2, which is not long-path aware. Mapping a short `subst` drive did not help, because Node resolves it back to `C:\`. Fixed with SDK `cmake;3.31.6` (ninja 1.12.1) through `cmake.dir` in `android/local.properties`.
3. Memory: the machine had under 1 GB free during the first build and the emulator shut down. Stopping Gradle daemons and this project's Supabase stack freed enough.

Web screenshots in `evidence/m1/web-*.png` are from 25 October, before the gap-closure pass. The current web state is covered by the e2e run above.

## Not verified

- CI workflow; staging web preview.
- Worker SIGINT/SIGTERM shutdown under a real signal on Windows.
- Accessibility audit (screen reader, zoom, keyboard, TalkBack); design-token contrast is unit-tested only.
- Licensed fonts not supplied; system fallbacks render.
- ESLint boundary rule does not cover web `"use client"` modules.
- Supabase `vector` log container restarts continuously in this environment (the other project's copy too); not needed for the database.

## Unresolved issues and owners

- iOS access - product owner (see Status).
- Project git repository - product owner to approve `git init` in `build-kit`. Nothing has been committed; the enclosing repo is the home directory.
- Business decisions D02-D10 (`docs/00`) remain open; all prices are fictional, fees are 0 and the policy is marked proposed.
- Fonts, logo and venue photography (D08).
- Duplicate `formatInrPaise` in web and mobile; design-token values copied by hand into `apps/web/app/globals.css`. Consolidate in M2.
- `android/local.properties` is regenerated away by `expo prebuild --clean`. Consider a small config plugin in M2, or document it in CI.
- Partner/staff/admin pages are unauthenticated preview shells and must not be deployed publicly before M2.

## Machine state left behind

- Installed on this machine: Android SDK `emulator`, `system-images;android-36;google_apis;x86_64`, NDK 27.1 (auto-installed by Gradle), `cmake;3.31.6`; AVD `simplysit_api36`; Gradle 9.4.1 distribution; Playwright Chromium.
- Stopped: Metro, web dev servers, emulator, Gradle daemons, build-kit Supabase stack. The other local Supabase project (`Djain`) was never touched.

## Rollback

All M1 work is additive under `build-kit/` apart from: `.gitignore` (lines added), `docs/agent-context.md` (one paragraph), `config/.env.example` (one line) and the task records. Generated `apps/mobile/android/` can be deleted at any time and regenerated with `expo prebuild`.

## Next concrete task

M2.1 - migrations and seed (backend engineer):
1. Read `docs/05-BACKEND-SCHEMA.md` and `docs/07-API-AND-STATE-MACHINES.md`. Write `tasks/current/PLAN.md` for M2.1 with exact migration filenames.
2. Create the first reviewed migration in `supabase/migrations/` for venues, tables (exclusive inventory with a `btree_gist` exclusion constraint), opening hours and policy snapshots that store `policyVersion` from `packages/domain/src/policy.ts`.
3. Replace the `supabase/seed.sql` placeholder with the synthetic venues and tables from `packages/synthetic-data`.
4. Acceptance: `pnpm db:reset` applies from empty; a real PostgreSQL test in `tests/integration` proves that overlapping holds on the same table conflict and different tables do not.
