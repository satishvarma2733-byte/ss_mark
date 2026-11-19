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

## Step B - dark mode (16 November 2026, web)

- `apps/web/app/globals.css`: 60 hard-coded colours replaced with tokens. New role tokens: `--on-brand`, `--chrome-bg`,
  `--chrome-bg-deep`, `--chrome-accent`, `--on-chrome`, `--on-chrome-soft`, `--chrome-line`, `--status-warm(-surface)`,
  `--status-danger(-surface)`, `--status-neutral-surface`, `--status-error-hover`, `--row-hover`, `--skeleton-base`,
  `--map-road-opacity`. Dark theme now also overrides `--brand-primary` (#dce3d2), its hover/active shades and
  `--brand-sand` (#485344, used as the border colour). Header and portal sidebar stay dark olive in both themes.
  Still fixed on purpose: QR code (white/dark), camera scanner (black), mock-gateway banner.
- `components/theme-toggle.tsx`: reads the applied theme, keeps several toggles in step, tolerates blocked storage.
  Toggle added to the partner and admin top bars (`lib/partner-page.tsx`, `lib/admin-nav.tsx`).
- `app/layout.tsx`: small inline script applies a saved theme before first paint (no flash); `suppressHydrationWarning`
  on `<html>` for the `data-theme` attribute it sets.
- Portal top bar on narrow phones: time-zone note hidden and breadcrumb truncates, so the added toggle fits at 320 px.
- `e2e/accessibility.spec.ts`: new test "dark mode passes WCAG 2.2 A/AA checks on customer, partner and admin pages"
  (23 pages, 1440 px). `e2e/finance.spec.ts`: the reconciliation window is filled after hydration and verified - the
  earlier "flake" was the React-controlled date fields resetting to the default 24-hour window.
- Not done: no frame-by-frame comparison with Figma page 12; native app has no dark theme; dark mode not scanned at 320 px.

Checks (local Supabase, MOCK providers): `tsc --noEmit` (web) clean; `pnpm lint` clean; `pnpm test:unit` 14 files / 79
tests; `next build` OK; `npx playwright test` 49/49 passed. A one-off axe contrast run over 30 routes in dark reported
0 findings (temporary script, deleted). Integration tests not re-run (no database or API code changed).

## Step C - one component system (16 November 2026, web)

Decision: the kit components render the existing, Figma-matched classes in `globals.css` (`.button`, `.card`,
`.status-pill`, `.chip`) instead of the parallel `ss-btn` look, so pages and kit share one style and the DOM is unchanged.

- `components/ui/button.tsx`: `Button` (variants primary/secondary/ghost/danger, sizes, `block`, `loading`) and new
  `ButtonLink`; duplicate `.ss-btn*` rules removed from `ui.css`; `.button.sm/.lg/.ghost` added.
- New `components/ui/layout.tsx` (`Card`, `StatusPill`, `FilterChip`, `Tabs`) and `components/ui/booking.tsx`
  (`DatePicker`, `TimeSelector`, `QrBookingCard`, `friendlyDate`).
- Codemod (TypeScript AST, temporary script, deleted) over `app`, `lib`, `components`: 139 cards, 86 buttons,
  34 button-links, 33 status pills, 10 link chips in 70 files. Native buttons without a `type` got `type="submit"`
  so form behaviour is unchanged (kit `Button` defaults to `type="button"`).
- `/bookings/[id]` uses `QrBookingCard`; `/venues/[id]` uses `DatePicker` and `TimeSelector`.
- Not migrated: `.input` fields (about 99), `.notice` (about 65), status pills with computed class names (about 22),
  label/checkbox chips, `Tabs` (no adopter yet). Old class rules are still needed by the kit, so none were deleted.

Checks: `tsc --noEmit` (web) clean; `pnpm lint` clean; `pnpm test:unit` 79 passed; `next build` OK;
`npx playwright test` 49/49 passed. No visual comparison against Figma frames was done for this step.

## Step D (part 1) - payment outcomes and portal notification centres (16 November 2026, web)

- `/payment/return`: every outcome (confirmed, failed, hold ended, refund pending/processed, under review, verifying,
  not found) now uses one centred layout with a state icon, the existing server-derived title and text, the next-step
  button and a "Your bookings" button. Titles, test ids and copy are unchanged. Styles: `.outcome*` in `globals.css`.
- New `/partner/notifications` and `/admin/notifications` (inside the portal shells, gated like other portal pages);
  the portal bells link there. They show the signed-in person's own notifications via `myNotifications` (no new API).
- `components/ui/recovery-banner.tsx` deleted: unused, and its fixed copy ("No charge was confirmed") could be wrong
  when a refund is pending; the pages derive their text from booking, payment and refund states.
- E2E: new test in `notifications.spec.ts`; both new pages added to the light and dark accessibility lists.
- Still open in step D: notification preferences and privacy preferences (no storage exists: needs a migration and
  the notification job to honour it), partner arrival progression screens, partner support centre, admin
  partner-and-venue management, system settings, secure admin access. Not compared frame by frame with Figma.

Checks: `tsc --noEmit` (web) clean; `pnpm lint` clean; `next build` OK; `npx playwright test` 50/50 passed, then
`journey.spec.ts` + `notifications.spec.ts` 13/13 after a small follow-up (button on the not-found state).

## Step D (part 2) - notification preferences (16 November 2026)

- Migration `supabase/migrations/20261116000100_notification_preferences.sql` (applied locally with
  `npx supabase migration up`, no reset): table `notification_preferences` (forced RLS, no direct grants),
  `app.is_optional_email`, `app.my_notification_preferences`, `app.set_notification_preferences`, and `app.notify_user`
  now skips the EMAIL row for optional templates (booking_confirmed, booking_ending, extension_applied,
  review_published, review_hidden, ticket_resolved, ticket_closed) when the person turned email copies off. Essential
  templates are always emailed; the inbox row is never affected. Rollback: restore `notify_user` from migration
  `20261103000500` and drop the table and the three functions.
- Decisions made here, for the owner to confirm: email copies default ON (unchanged behaviour; the Figma frame shows
  "Off"); "Offers & announcements" is a stored choice only (nothing sends marketing).
- Contracts `notificationPreferencesInputSchema`; db wrappers `myNotificationPreferences`, `setNotificationPreferences`;
  API `GET/PUT /api/v1/me/notification-preferences`; page `/account/notifications` (linked from `/account` and
  `/notifications`). Kit `Switch` gained `hideLabel` and a higher-contrast off state. Docs 05 and 07 updated.
- Tests: 3 integration tests (defaults and per-person saving; opt-out skips optional email only; no direct table
  access), 1 e2e test, page added to light and dark accessibility lists.
- E2E helper `signInWithEmailCode` now waits for hydration and verifies the email value (a slow run submitted the
  form empty: "Some details need attention").

Checks: `pnpm typecheck` clean; `pnpm lint` clean; `next build` OK; `npx playwright test` 51/51 passed.
`pnpm test:integration`: 176 of 178 - the two failures are in `discovery.test.ts` (unfiltered search no longer returns
the test venue on its first page). Cause: 236 venues created by e2e runs on 16 Nov in the un-reset local database; the
same file passed (175/175) earlier the same day. NOT fixed: needs `pnpm db:reset` (wipes local data) or a test that
filters its search. `pnpm test:unit` not re-run in this step.

## Step F, slice 1 - native venue page and gallery (19 November 2026, Expo app)

- `apps/mobile/app/venue/[id].tsx` rebuilt to Figma "Customer · Venue detail" (94:9976) inside the shared `Screen`
  shell (brand header, back bar, tab bar): large first photo with "1 / n" caption opening the gallery, category line,
  display title, rating or "New on Simply Sit", Directions (OpenStreetMap), address, today's hours, amenities with
  unverified ones marked, table cards with hourly price and free start times, food notice, house rules and hours,
  a recent review, and a pinned price bar whose button scrolls to the tables. Booking behaviour and test ids
  (`venue-rating`, `venue-photos`, `bookings-paused`, `table-slots`, `slot`) are unchanged.
- New `apps/mobile/app/gallery/[id].tsx` (Figma 94:17490), registered in `app/_layout.tsx`; new `lib/labels.ts`
  (same catalogue labels as the web). `components/shell.tsx` `Screen` gained optional `footer` and `scrollRef`.
- Distance is not in the venue data, so the frame's "1.2 km" is not shown. "No food minimum" is shown as
  "No compulsory order" (the product promise; no minimum-spend field exists).
- Verified on the Android emulator (simplysit_api36, dev build, Metro in CI mode): venue page, pinned button scroll,
  gallery open and back. The final text trim of the price bar was checked by typecheck and export only.
- Not done: the remaining Expo screens in the mapping table; new app icons need a native rebuild to appear.

Checks: `pnpm --filter @simply-sit/mobile typecheck` clean (after Metro regenerated typed routes); `pnpm lint` clean;
`pnpm test:unit` 79 passed; `pnpm test:mobile` exported Android and iOS bundles.

## Step F, slice 2 - native book (review and hold) screen (19 November 2026)

- `apps/mobile/app/book.tsx` rebuilt to Figma "Customer · Select table and time" (94:10119), review half: shared
  `Screen` shell, three-step indicator, date / party / start / duration facts with "Change table or time", the
  selected table card (label and seats passed from the venue page as `tableLabel` and `seats`), the cleaning note
  from the policy buffer, price rows from the server quote (hourly, platform fee, taxes "Not configured", total),
  the rules switch and "Hold table and continue to payment". Hold behaviour, idempotency and test ids
  (`go-sign-in`, `book-problem`, `quote-total`, `accept-rules`, `hold-table`) are unchanged.
- Verified on the Android emulator with a fresh local test account (signed in by email code from Mailpit): signed-out
  state, quote state, hold button disabled until the rules are accepted, hold succeeded and opened checkout. The test
  hold SS-MEXVK3GHYJ was released (CANCELLED).
- Found: the checkout screen still uses the old layout and its mock-payment label overlaps the status bar (no safe
  area). Next slice.

Checks: mobile typecheck clean; `pnpm lint` clean; `pnpm test:unit` 79 passed; `pnpm test:mobile` exported Android
and iOS bundles.
