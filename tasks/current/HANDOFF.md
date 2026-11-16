# Handoff - M6 Release preparation (local part)

Date: 3 November 2026. Brief/plan: `BRIEF.md`, `PLAN.md`; review: `REVIEW.md`; release package:
`tasks/current/release/` (RELEASE-PACKAGE, SECRETS-AND-CONFIG, RUNBOOK, STORE-DISCLOSURES, VENUE-REHEARSAL).
Earlier: `tasks/archive/m5` (quality, not a release candidate). Local stack and MOCK providers throughout.

## Status

**Release package drafted; not ready for the owner's final authorization.** Blocking: M5.1 independent review (a
fresh-session review has been proposed), owner decisions D02-D04, D06-D10, organization accounts (payment provider,
hosting, stores, Apple/EAS), production app identifiers, real devices and iOS, hosted restore.

## What changed

- Release switches (M6.A): `supabase/migrations/20261103000900_m6_release_switches.sql` (table, guard triggers,
  `app.service_status`, `app.admin_release_switches`, `app.admin_set_release_switch`); `supabase/seed.sql` opens them
  locally. API `GET /api/v1/service-status`, `GET/POST /api/v1/admin/release-switches`; admin page `/admin/release`
  (linked from admin home); paused notices on the web venue and book pages and the app venue/extension screens. New
  error codes BOOKINGS_PAUSED, EXTENSIONS_PAUSED (503), PAYOUTS_PAUSED (409).
- Native compatibility (M6.B): `NATIVE_MIN_VERSION` server setting; app sends `x-simply-sit-client: android|ios/<version>`;
  quote, hold, checkout and extension request/hold/checkout routes return 426 UPDATE_REQUIRED below the minimum
  (`apps/web/lib/service-status.ts`, `authedRoute` option `startsCommitment`); app shows an update notice
  (`apps/mobile/lib/sales-state.ts`, `service-status.ts`).
- Operations checks: `scripts/ops-checks.sql` (`pnpm ops:check`), 14 checks with thresholds.
- Android permissions: `app.json` blocks SYSTEM_ALERT_WINDOW, legacy storage, USE_BIOMETRIC/USE_FINGERPRINT (found in
  the release APK, unused by the app); applied with `expo prebuild --platform android --no-install --no-clean`.
- Tests: `tests/integration/release-switches.test.ts` (6), `apps/web/e2e/release.spec.ts` (3), unit tests for version
  comparison, client header and sales state; accessibility scan covers `/admin/release`; Playwright web server sets
  `NATIVE_MIN_VERSION=0.1.0`.

## Checks

See the check table at the end (filled after the final run).

## Figma v2 UI pass (9 November 2026, web)

Source: Figma file `PLQfThace0FturOrjF7fAT` ("simply-sit (Copy)"), 40 new frames in groups A-G. Backup before edits:
`../backups/pre-figma-v2-2026-11-09/apps.tar`. Behaviour, APIs and payment/permission rules are unchanged; screens were
restyled to the frames using the data the app already has.

- Customer web (E, 8 frames): `/sign-in`, `/venues/[id]/book`, `/checkout/[bookingId]`, `/bookings/[id]` (pass; cancelled
  bookings show refund tracking), `/bookings`, `/bookings/[id]/extend`, `/bookings/[id]/cancel`, `/account` + `/help`.
- Partner desktop (C, 7 frames): `/partner/apply`, `/partner/inventory` (one table at a time), new `/partner/closures`,
  `/partner/staff`, new `/partner/incidents/new`, `/partner/bookings/[id]` (check-out and turnover), new `/partner/payouts`.
- Admin (D, 5 frames): `/admin/reviews` (queue + decision panel), `/admin/support`, new `/admin/finance/refunds`, new
  `/admin/finance/fees` (fee versions moved off `/admin/finance`), `/admin/metrics` (reports layout).
- Deliberate differences from the frames: sign-in stays email OTP (frames show phone/SMS); no payment details, UPI IDs,
  bank details, severity or evidence uploads are collected (no API stores them); payout destination shows "not connected"
  (provider onboarding not built); no marketplace CSV export exists, so the reports page says so; GST rows show "Not
  configured" (no tax rate approved).
- E2E specs updated to the new UI: sign-in helper names, booking heading, extension radios + acknowledgement, partner apply
  checkbox, closures page, review "Open" step, fee-versions page. Accessibility scan now covers the new pages.
- Not done yet: partner mobile (F, 4 frames) and the Expo app frames (A, B, G, 16 frames).

Checks (local stack, MOCK providers): `pnpm --filter @simply-sit/web exec tsc --noEmit` clean; `pnpm --filter
@simply-sit/web build` OK; `npx playwright test` (apps/web) 48 passed.

## UI polish pass (12 November 2026, web)

Behaviour, APIs, payment and permission rules unchanged. Nothing committed.

- `apps/web/app/globals.css`: "Polish layer" appended at the end (motion, shadows, hover/pressed states, sticky header,
  phone bottom tab bar, swipeable portal menu and two-across metrics on phones, table row hover, message pages) plus
  venue-page styles. Colours and text contrast unchanged.
- `components/site-nav.tsx`: the three text links are wrapped in `.site-nav-links` with icons shown only in the phone tab bar.
- `app/venues/[id]/page.tsx`: header, photo strip, details beside a sticky "Choose a time" card; friendly date labels
  (option values unchanged); hours as a list.
- New `app/not-found.tsx`; `app/error.tsx` restyled; `app/loading.tsx` heading is now "Loading...".
- `e2e/journey.spec.ts`: 404 assertion follows the new not-found heading.
- Not done: Expo app (`apps/mobile`) was not touched; portal desktop pages were not re-screenshotted after the pass.

Checks (local stack, MOCK providers): `pnpm exec tsc --noEmit` clean; `pnpm exec next build` OK; `npx playwright test`
47/48 then `journey.spec.ts` + `accessibility.spec.ts` 15/15 after the assertion update.

## Figma Design System & Missing Admin/UI Kit Pass (14 November 2026)

- Extracted Figma Light (`94:123`) & Dark (`94:167`) tokens and typography scale from `DA7i1rigZ1Mjb0lLX7ndV2` into `packages/design-tokens/src/index.ts` and `apps/web/app/globals.css`, with WCAG 2.2 AA contrast tests in `packages/design-tokens/src/tokens.test.ts`.
- Added Light/Dark theme toggle (`apps/web/components/theme-toggle.tsx`) in `SiteNav`.
- Added centralized UI Kit primitives in `apps/web/components/ui/` (`Button`, `IconButton`, `Field`, `Input`, `Textarea`, `Select`, `SearchBar`, `Checkbox`, `RadioGroup`, `Switch`, `Badge`, `StatusIndicator`, `Alert`, `EmptyState`, `ErrorState`, `Skeleton`, `KpiCard`, `Breadcrumbs`, `Pagination`, `Tooltip`, `Modal`, `Drawer`, `ConfirmDialog`, `ToastProvider`, `ImageGallery`, `RecoveryBanner`) and wired `ImageGallery` into `app/venues/[id]/page.tsx`.
- Added RLS-enforced Admin pages `/admin/audit`, `/admin/customers`, and `/admin/users` and linked them in `apps/web/lib/admin-nav.tsx`.
- Fixed mobile typecheck (`apps/mobile/app/(tabs)/index.tsx`), mobile ESLint (`apps/mobile/app/_layout.tsx`), and preview spec lint (`apps/web/e2e/zz-design-preview.preview.ts`).
- Audit & mapping docs created: `PROJECT_AUDIT.md`, `IMPLEMENTATION_PLAN.md`, `DESIGN_SYSTEM_MAPPING.md`.

Checks (14 November 2026, local Supabase + MOCK providers): `pnpm typecheck` clean (11 workspace projects); `pnpm lint` clean (0 errors, 0 warnings); `pnpm test:unit` 14 files / 79 tests passed; `pnpm --filter @simply-sit/web build` OK; `pnpm test:integration` (after `pnpm db:reset`) 18 files / 175 tests passed; `pnpm test:e2e` 47/48 passed on full run + `smoke.spec.ts` 4/4 passed on re-run.

## Audit refresh (16 November 2026)

No application code changed. `PROJECT_AUDIT.md`, `IMPLEMENTATION_PLAN.md` and `DESIGN_SYSTEM_MAPPING.md` rewritten/updated to
the verified state: UI kit built but adopted on 5 files only; 6 kit components not built; 61 hard-coded colours block dark
mode; recovery states, notification preferences and portal notification centres missing; production items blocked on
owner decisions (D02-D04, D09) and accounts.

Checks (16 November): `pnpm typecheck` clean; `pnpm lint` clean; `pnpm test:unit` 14 files / 79 tests passed.
Integration, e2e and build NOT re-run (local Supabase containers stopped).

## Step A - baseline (16 November 2026)

- Git repository created in `build-kit` (branch `main`), baseline commit `977d332`; `.gitignore` gained `*.tsbuildinfo` and
  `preview-shots/`. `pnpm secrets:check` passed before the commit. No remote; nothing pushed.
- Environment templates already existed (`config/.env.example`, `config/.env.staging.example`); audit corrected.
- Fix: `apps/web/app/globals.css` - portal figures two across on phones (12 Nov) let a long money value widen `/admin` at
  320 px after a resize. Values now wrap at 22px and the row is one column below 380 px.

Checks (local Supabase, MOCK providers, database NOT reset): `pnpm test:integration` 18 files / 175 tests passed;
`pnpm exec next build` OK; `npx playwright test` 46/48 on the full run (accessibility portals @320 failed: fixed above;
`finance.spec.ts:17` failed once and passed on two re-runs - treat as flaky, cause not investigated); after the fix
`accessibility.spec.ts` + `finance.spec.ts` 7/7 passed. The full 48-spec suite was not re-run after the fix.
