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

## Step F, slice 3 - native checkout and payment status (19 November 2026)

- `apps/mobile/app/checkout/[bookingId].tsx` rebuilt to Figma "Customer · Checkout and payment" (94:10244) in the shared
  shell: "Review & pay · Step 2 of 3", hold countdown notice, booking summary (venue, area, table, guests, date, time,
  duration, reference, "On hold · Payment required"), price rows from the booking's price snapshot, "How you will pay"
  (method chosen on the provider page; the app collects no payment details - the frame's UPI chooser is not built),
  "Know before you book" (refund cutoff from the policy snapshot; says when the free window has already closed), pay,
  release, and the verification note. Pay, release, polling and deep-link return are unchanged; test ids kept.
- `apps/mobile/app/payment-return.tsx` moved into the shared shell ("Payment status · Step 3 of 3") with a state icon;
  copy, logic and test ids unchanged. Fixes the mock-payment label overlapping the status bar on both screens.
- Verified on the Android emulator: hold, checkout, Pay, mock gateway "Pay (success)", return to the app and
  "Booking confirmed" (SS-KFBXXEVT38 CONFIRMED in the database), payment status screen in the new shell, and a second
  hold (SS-7GD7QETE4M) released. The "refund window closed" wording was checked by code review only (no bookable start
  had a passed cutoff during the run).
- Noticed, not changed: the web mock-gateway page shows the customer phone tab bar inside the provider stand-in.

Checks: mobile typecheck clean; `pnpm lint` clean; `pnpm test:unit` 79 passed; `pnpm test:mobile` exported Android
and iOS bundles.

## Step F, slice 4 - native booking pass (19 November 2026)

- `apps/mobile/app/booking/[id].tsx` rebuilt to Figma "Customer · Confirmed booking pass" (94:10372) in the shared
  shell ("Your booking", subtitle the booking reference): status headline, "See you at <venue>", status pill, booking
  ID, summary card (venue, area, table, guests, date, time, duration), check-in pass (QR, PIN, handover instructions,
  check-in opens 15 min before start, reserved time), Directions (OpenStreetMap) and Receipt (scrolls to the receipt),
  "Cancellation & refunds" while CONFIRMED (deadline, says when it has passed, Manage booking while cancellable), house
  rules, receipt with extension lines and payment state. Checked-in, completed, cancelled and refund notices and all
  test ids (`booking-status`, `booking-ref`, `arrival-pin`, `cancel-booking`, `extend-booking`, `review-booking`,
  `extension-line`) kept.
- Verified on the Android emulator with SS-KFBXXEVT38 (CONFIRMED): every section renders; Receipt scrolls to the receipt
  card. Fixed a doubled period when the venue name ends in "." ("Chapter & Co."). Other states (checked in, completed,
  cancelled) checked by code review only.

Checks: mobile typecheck clean; eslint clean on the screen; `pnpm test:unit` 79 passed; `pnpm test:mobile` exported
Android and iOS bundles.

## Step F, slice 5 - native my bookings (19 November 2026)

- `apps/mobile/app/(tabs)/bookings.tsx` rebuilt to Figma "Customer · My bookings" (94:10467) in the shared shell ("Your
  hours, in one place"). Upcoming / Completed / Cancelled tabs with counts: both API scopes (`upcoming`, `past`) load
  together and past is split by status; ended holds count as cancelled. Upcoming card: status pill ("Confirmed ·
  Today"), venue, table, guests, ref, date and time, paid amount, "View pass & check in" (or "Complete payment" for a
  live hold), Directions / Receipt / Manage links. Completed card: Write a review (or Your review) and Receipt.
  Cancelled card: refund amount and status with "Track refund & get help", or "Nothing was charged" for released
  holds. Notifications moved to a bell button (`open-notifications` kept); `booking-card` and `booking-status` kept.
- Not built: the venue photo thumbnail (the booking list API has no photo) and the frame's "View all" link.
- Verified on the Android emulator: Upcoming (SS-KFBXXEVT38), Completed (empty state) and Cancelled (two released
  holds); "View pass & check in" opens the booking pass. The completed card and refund rows were checked by code
  review only (no such bookings in the local data). The "Paid" label tweak after the run was not re-checked on device.

Checks: mobile typecheck clean; eslint clean on the screen; `pnpm test:unit` 79 passed; `pnpm test:mobile` exported
Android and iOS bundles.

## Step F, slice 6 - native extension (19 November 2026, in progress)

- `apps/mobile/app/extend/[bookingId].tsx` rebuilt to Figma "Customer · Active booking and extension" (94:10575) in the
  shared shell: stay card with minutes remaining, +N min choices, "Your updated time" (estimate with ≈ from the booked
  hourly rate until the venue answers, then the request's price, as on the web), request / approved / held / declined
  states, unavailable-slot notice and a "Get help with this booking" link to `/support/new`. Test ids kept.
- Verified on the Android emulator: request, "Waiting for the venue" countdown, staff approval (via `app.decide_extension`
  in psql) showing "Check availability & pay", and withdraw. Extension payment not exercised.
- Local test data changed for this: SS-KFBXXEVT38 set to CHECKED_IN directly (its check-in window had closed) and a STAFF
  membership added for Chapter & Co. (venue `...0104`). Both test requests were withdrawn (CANCELLED).
- Fixed: after Withdraw, the "Ask the venue for 30 minutes" label was cut to "Ask the venue for 30" on Android. A uiautomator
  dump showed the TextView sized exactly to the full text and one line tall; the redraw wrapped the last word onto a hidden
  second line. `Button` labels in `components/ui.tsx` are now single-line (`numberOfLines={1}`; a too-long label ends in
  "…"). Tried and rejected: React keys, `textBreakStrategy="simple"` (no effect), `flexGrow` on the label (stretched the
  venue footer button over the price), `adjustsFontSizeToFit` (shrank every label). Re-checked on the emulator after a
  real request and withdraw; the venue footer and +/- steppers are unchanged.

## Venue profile header (19 November 2026)

- `apps/mobile/app/venue/[id].tsx`: cover photo (photo count chip, opens the gallery) with an overlapping logo badge,
  category eyebrow, name, short location ("HAL 2nd Stage, Bengaluru": area plus the address's last part) with
  Directions, and an icon card: address, hours today ("Open now · until 20:00" / "Closed now · opens 09:00"), current
  date and IST time, next free table for the selected day (from the availability call), rating and food rule.
- The logo is a monogram of the venue's initials: venues have no logo field yet. A real logo needs a schema field,
  partner upload and moderation (follow-up).
- Verified on the Android emulator with Chapter & Co.

## Venue logo (19 November 2026)

- Migration `supabase/migrations/20261119000100_venue_logo.sql` (applied locally with `npx supabase migration up`, no
  reset): `venue_media.kind` PHOTO/LOGO; partial unique indexes allow one APPROVED and one PENDING logo per venue;
  trigger `venue_media_logo_replace` retires the shown logo when a new one is approved (single review or whole-venue
  approval); `app.partner_add_logo` (manager/owner with TOTP, same key and alt-text rules as photos, withdraws an
  earlier pending logo, audit `logo.add`); public `app.venue_logo`. Photos-only filters added to `venue_photos`,
  `partner_add_media` (12-photo limit), `venue_publication_gaps` ("photo" gap); `partner_venue_overview` and
  `admin_venue_detail` media rows now carry `kind`. Rollback steps are in the migration header.
- Decision: no `logo_media_id` column on `venues` - `venues.version` is the partner editor's concurrency token and logo
  moderation must not invalidate an open venue form (photos do not either). The "reference" is the single APPROVED
  LOGO row, enforced by the unique index.
- Contracts: `venueMediaRefSchema`, `venueDetailSchema.logo` (nullable `{id, alt_text}`, default null), shared
  `venueMonogram`. API `GET /api/v1/venues/{id}` returns `logo`; new `POST /api/v1/partner/venues/{id}/logo`; photo and
  logo uploads share `apps/web/lib/venue-upload.ts`. Removal uses the existing `DELETE /api/v1/partner/media/{id}`.
  Docs 05 and 07 updated.
- Partner portal `/partner/venue`: new "Logo" card (shown logo, replacement waiting, not approved; upload/replace,
  remove); photo strip excludes logos. Admin `/admin/venues/[id]`: "Photos and logo", logos labelled, cover photo and
  pending text exclude/mention logos.
- Display: web venue page header shows the logo (64 px) or a monogram; native `apps/mobile/app/venue/[id].tsx`
  `VenueBadge` shows the logo image, falling back to the monogram when absent or if the image fails to load.
- Tests: 3 integration tests in `tests/integration/partner-operations.test.ts` (logo is not a photo, approved with the
  listing, public only when approved; replace/reject/approve keeps one shown logo and leaves `venues.version`
  unchanged; permissions and key validation), 2 unit tests in `packages/contracts/src/contracts.test.ts`.
- Local data changed for the display check: a synthetic PNG logo (128 px olive roundel, generated) uploaded to local
  Storage with the local service key and inserted APPROVED for Chapter & Co. (`...0104`); Copper Yard has none.
- Verified: `GET /api/v1/venues/...0104` returns the logo, `GET /api/v1/media/{id}` 200 image/png; web venue page shows
  the logo for Chapter & Co. and the "CY" monogram for Copper Yard (browser pane, local dev server).
- NOT verified: partner Logo card and admin review in a browser (needs a TOTP partner/admin sign-in; covered by
  integration tests at the database level and typecheck only); the native badge on the emulator (typecheck and bundle
  export only). No e2e spec added.

Checks (local Supabase, MOCK providers): `pnpm lint` clean; `pnpm typecheck` clean; `pnpm test:unit` 14 files / 81
tests passed; `pnpm test:integration` 18 files / 181 tests passed; `pnpm test:mobile` exported Android and iOS bundles.
`next build` and `pnpm test:e2e` not run. Nothing committed.

## Seat-map phase 1 - seating areas, floor plans and area prices (19 November 2026)

Plan and designs: `docs/concepts/seat-map/PLAN.md` (Figma screens linked there). Phase 1 is data and API only; no
screens use it yet.

- Migration `supabase/migrations/20261119000200_seating_layouts.sql` (applied locally with `npx supabase migration up`):
  `venue_zones`; `resources` + `zone_id`, `shape`, `features`, `photo_media_id`; `floor_layouts` (DRAFT -> PUBLISHED ->
  ARCHIVED, published rows frozen by trigger) and `layout_elements` (writes only into a draft). RLS forced, no client
  grants. Functions: `app.partner_create_zone`, `partner_update_zone`, `partner_archive_zone`, `partner_set_table_details`,
  `partner_save_layout_draft`, `partner_publish_layout`, `partner_set_zone_price`, `partner_seating`, public
  `app.venue_seating` and `app.venue_seat_map`. Rollback steps are in the migration header.
- Area price writes ordinary `resource_rates` versions (same rules as `app.partner_set_rate`; logic duplicated, not
  refactored, to leave the existing function untouched). Tables whose price differs from the area's previous price keep
  it unless `keep_custom_prices=false`. Quotes and bookings keep their snapshot (tested).
- Contracts (`packages/contracts`): zone/table/layout/price request schemas, `venueSeatingSchema`, `seatMapSchema`.
  DB wrappers: `packages/db/src/seating.ts`. Routes: `GET /api/v1/venues/{id}/seating`, `GET /api/v1/venues/{id}/seat-map`,
  `GET /api/v1/partner/venues/{id}/seating`, `POST /api/v1/partner/venues/{id}/zones`, `PATCH /api/v1/partner/zones/{id}`,
  `POST .../zones/{id}/archive`, `PUT .../zones/{id}/layout-draft`, `POST .../zones/{id}/publish-layout`,
  `POST .../zones/{id}/price`, `PATCH /api/v1/partner/resources/{id}/details`. Documented in docs/05 and docs/07.
- Seed (`supabase/seed-design-venues.sql`, appended, re-runnable): Copper Yard "Brewery hall" (indoor, L01, L02) and
  "Courtyard" (outdoor, C01, C02); Chapter & Co. "Reading room" (D01, D02), each with a published drawing. Applied to the
  running local DB by piping only that block (the file's earlier opening-hours insert is not re-runnable on a live DB).
- Live check on a production server (`next start --port 3101`, stopped after): seating 200; seat map shows Copper Yard
  tables UNAVAILABLE (OUTSIDE_HOURS) at 11:00 and FREE at 18:00, C02 TOO_SMALL for 4; no internal price fields; partner
  route 401 without a session; a start time without an offset is 422.
- Note: the `simply-sit-web` dev server on port 3000 (another session's preview) showed a stale compile error after
  `pnpm build` wrote into the shared `apps/web/.next`; restart that preview to clear it.
- Not done (later phases): partner editor and pricing screens, customer seat map (mobile, web), busy-hour pricing,
  per-seat booking (owner decision). No e2e spec yet.

Checks: `pnpm lint` clean; `pnpm typecheck` clean; `pnpm test:unit` 14 files / 85 tests passed (4 new contract tests);
`pnpm test:integration` 19 files / 187 tests passed (new `tests/integration/seating.test.ts`, 6 tests); `pnpm build`
passed; `pnpm secrets:check` clean. `pnpm test:e2e` not run. Nothing committed.

## Seat-map phase 2 - partner floor editor and prices (19 November 2026)

- `/partner/floor` (`apps/web/app/partner/floor/`), Figma "Dine-in floor setup" (2067:1575): areas list with add and
  edit (name, type, floor, features); per-area SVG floor drawing (drag to move with snap to grid, arrow keys nudge,
  Shift for 1 unit, R rotates, Delete removes; rotate/duplicate/remove toolbar); "Add to the floor" places the area's
  tables and room items (wall, door, window, counter, stairs, pillar, plant, label); "Move ... here" puts tables that
  are in no area into the current one; the selected table's shape, features and photo (approved venue photos) save to
  `PATCH /partner/resources/{id}/details`; exact position fields; live overlap/outside-floor check (`lib/floor-plan.ts`,
  mirrors `app.layout_problems`; server problems are listed too); Save draft, Discard, Preview as guest, Publish
  (saves first when needed). New floors start at 600 x 400 units; the side panels sit under the drawing below 1500 px.
- `/partner/prices` (`apps/web/app/partner/prices/`), Figma "Area and table pricing" (2070:1707): step 1 area prices
  (`POST /partner/zones/{id}/price`, keep special prices on by default), step 2 per-table prices
  (`POST /partner/resources/{id}/rates`, marked "Special price" / "Area price" / "Own price"), start right away or
  from a date and time (IST), "What guests will see" with each area's from-price. Busy-hour step shows "Coming soon".
- Sidebar: "Floor plan" and "Prices" added for managers and owners (`lib/partner-page.tsx`). Styles appended to
  `app/globals.css` (tokens only; dark mode checked).
- Tests: `apps/web/lib/floor-plan.test.ts` (5 unit); `apps/web/e2e/seating.spec.ts` (manager adds an area, moves and
  places tables, drag creates an overlap that blocks publishing, keyboard nudge clears it, publish, area and special
  prices, public seating API reflects both); both pages added to the portal and dark-mode accessibility scans.
- Fixed during verification: the publish bar inherited the card's column layout; a hidden legend made the prices page
  scroll sideways (reflow-320); price boxes did not follow an area price change; panels lost their "saved" message on
  refresh (now keyed by id).

## Seat-map phase 3 - customer seat map in the native app (19 November 2026)

- `apps/mobile/components/SeatingSection.tsx` (new), used by `apps/mobile/app/venue/[id].tsx` when the venue has a
  published floor drawing (`GET /venues/{id}/seating`); otherwise the screen keeps the table list. "Show tables as a
  list" / "Show the floor map" switch between them; the list is also used while bookings are paused.
- Area cards (kind icon, from-price, table count); start-time chips = starts at which a table of that area is free
  for the chosen day, length and party (from the existing availability call); floor map drawn with positioned Views
  (no native SVG module, so no dev-client rebuild) and coloured from `GET /venues/{id}/seat-map` (free, your pick,
  booked, too small dashed); every table is a button with a spoken label. Tapping a table opens a bottom sheet: photo
  when set, area, seats, features, price per hour, this table's free starts (or "Booked at X · free at"), total, and
  "Hold <table> at <time>", which opens the existing review/quote screen (`/book`) - the hold path is unchanged.
- API client: `getSeating`, `getSeatMap` (`packages/api-client`).
- Verified on the Android emulator with Copper Yard: Brewery hall (L01, L02 free at 19:30, bar and entrance shown);
  sheet for L02 with ₹250.00 total and Hold -> review screen showing Long table L02, 19:30, 1 h; Courtyard with 4
  guests (C01 free and round, C02 dashed "too small", plant and "Open air" label). Area cards widened so the
  from-price fits. No hold was created.
- Not done: web customer seat map (phase 4), busy-hour pricing (phase 5). No automated UI test for the native map
  (mobile has no UI test runner); covered by the API integration tests and the emulator check above.

Checks: `pnpm lint` clean; `pnpm typecheck` clean; `pnpm test:unit` 15 files / 90 tests; `pnpm test:mobile` exported
Android and iOS bundles. Phase 2 checks (above) unchanged. Nothing committed.

## Seat-map phase 4 - customer seat map on the web (19 November 2026)

- `apps/web/app/venues/[id]/seat-map.tsx` (client component), shown at the top of the venue page's main column when
  the venue has a published floor drawing and times were loaded (`app.venue_seating` read server-side). Area tabs with
  kind, table count and from-price; start-time radio chips (free starts of the area's tables on the chosen date from
  the "From" time); SVG floor coloured from `GET /api/v1/venues/{id}/seat-map` (free, your pick, booked, too small),
  tables focusable and operable with Enter/Space, spoken labels; side panel (beside the floor from 1200 px, below it
  otherwise) with photo, area, seats, features, price, this table's free starts, total and "Hold <table> at <time>",
  a link to the existing `/venues/{slug}/book` page (sign-in first when signed out, returning to that table and time).
  The per-table list in "Choose a time" is unchanged. A group too big for every table in the area gets a message.
- Long table names that would not fit a small table show only their last word on the drawing (web and mobile).
- Test: `apps/web/e2e/seating.spec.ts` second test (area, start, pick, panel, Hold -> sign-in with the book page as the
  return path; 5 guests -> "No table in Garden is free for 5 guests"). Both seating tests pass.

Checks: `pnpm lint` clean; web and mobile typecheck clean; `pnpm test:unit` 90 passed; `pnpm build` passed;
`pnpm test:mobile` exported Android and iOS bundles; `playwright test e2e/seating.spec.ts` 2 passed. The full e2e and
accessibility suites were not re-run after this phase (phase 2 runs: 53/54, failure explained there). Nothing committed.

## Seat-map phase 5 - busy-hour pricing (20 November 2026)

- Migration `supabase/migrations/20261120000100_busy_hour_rates.sql` (applied locally): `public.rate_rules` (days,
  local window, -50%..+100%, whole venue or one area; ACTIVE -> ARCHIVED only, never edited or deleted; RLS forced).
  `app.price_for` now applies the rule in force at the booking start (venue-local weekday and time; area rule beats
  venue rule, then the larger change) to the table-time base, half-up integer paise; the service fee is not adjusted.
  The snapshot adds `base_before_busy_paise` and `busy_rule {id, label, adjustment_bps}` (null when none). With no
  rule the price is identical to before (full integration suite unchanged). Extensions starting inside a window carry
  the same adjustment (they use `app.price_for`). New: `app.partner_create_rate_rule`, `app.partner_archive_rate_rule`,
  `app.busy_rule_for`; `app.partner_seating` lists active rules. Rollback steps in the migration header.
- Routes: `POST /api/v1/partner/venues/{id}/rate-rules` (idempotent), `POST /api/v1/partner/rate-rules/{id}/archive`.
  Contracts: `rateRuleCreateSchema`; `priceSnapshotSchema` gains the two optional fields (old snapshots still parse).
- Partner `/partner/prices` step 3: active rules with Stop, a week strip, and an add form (name, all areas or one
  area, days, from/until IST, more/less and percent, live example on a real table).
- Guests: web and mobile review screens show "Busy hour · <label> (+20%)" as its own line (table line shows the normal
  price, so the rows add up); seat-map panels (web and mobile) say "Includes busy-hour price: ...".
- Known limit: the per-table "₹X for 1 h" in the web/mobile table list is priced at noon for the day (as before), so it
  can differ from an evening busy-hour price; the quote/review screen always shows the real price before a hold.
- Tests: `tests/integration/seating.test.ts` busy-hour block (validation and staff refusal; +20% inside / none outside;
  area -10% beats venue +20%; seat map shows the same price; a held booking keeps its price and rule after archive;
  rules cannot be updated directly; audit). `apps/web/e2e/seating.spec.ts` extended (owner adds and stops a rule;
  guest panel shows the +20% total and the "Festival week (+20%)" note).
- Needs an independent review before release (price calculation change; CLAUDE.md).

Checks: `pnpm lint` clean; `pnpm typecheck` clean; `pnpm test:unit` 90 passed; `pnpm test:integration` 19 files /
189 passed; `pnpm build` passed; `pnpm test:mobile` exported; `playwright test e2e/seating.spec.ts` 2 passed;
accessibility portal + dark-mode scans passed; `pnpm secrets:check` clean. Full `pnpm test:e2e`: 54 passed, 1 failed - the same smoke search test as in phase 2 (DEMO Cafe Koramangala pushed off the first results page by ~500 leftover local e2e venues at the same spot; not code-related, CI uses a fresh database).
Nothing committed.

## Busy-hour pricing - review fixes (20 November 2026)

Independent review (`/code-review high` on `20261120000100_busy_hour_rates.sql`, 9 findings) addressed in
`supabase/migrations/20261120000200_busy_hour_review_fixes.sql` (applied locally; `app.rate_rule_json` re-applied by
hand after a same-session edit, so the local DB matches the file):
- Each booked minute takes the rule covering it (area beats venue, then the larger change); with no rule the
  arithmetic is unchanged. Snapshot: `busy_rules [{id, adjustment_bps, minutes}]`, no partner label
  (`busy_rule` from the first format still parses). `app.busy_rule_for` dropped; new `app.rule_covers`.
- Windows may cross midnight (weekday = day the window starts); "24:00" stored as 00:00 and returned as "24:00";
  an empty window is refused. `rate_rule_json` adds `overnight`.
- `app.venue_day_availability` shows the plain table price (`app.plain_price_for`) and returns `has_busy_pricing`;
  web and mobile lists show a note. Archiving an area archives its rules. `app.seating_editor_state` is the single
  editor-state definition. `price_for` skips rule work when the venue has no active rule.
- Guests: shared `busyHourText` (contracts) for "Busy-hour price (+20% for 30 min)" on review/checkout (web, mobile)
  and the seat-map panels. Extension estimate text now mentions busy-hour prices (the estimate number is still hourly x
  minutes; the venue's request has the exact price). Partner form accepts overnight windows; the week strip draws the
  after-midnight tail on the next day.

Checks: `pnpm lint` clean; `pnpm typecheck` clean; `pnpm test:unit` 92 passed; `pnpm test:integration` 19 files / 190
passed; `pnpm build` passed; `playwright test e2e/seating.spec.ts` 2 passed; portal accessibility scan passed;
`pnpm test:mobile` exported. Nothing committed.

## Step F, slice 6b - native cancellation review (20 November 2026)

- `apps/mobile/app/cancel/[bookingId].tsx` rebuilt to Figma "A · Customer mobile · Review cancellation" (94:11328) in
  the shared shell ("Cancel this booking?" · "Review only · <time> IST · Not cancelled"): booking card with
  "Confirmed · Still reserved", "Your table will be released" warning, "What you’ll get back" (original payment,
  refundable, not refunded, refund to original method, when the refund amount changes), "Your accepted policy" from
  the booking's policy snapshot, reason chips, an "I understand ..." switch that enables "Confirm cancellation ·
  Refund ₹X" (secondary), and "Keep my booking" as the primary action. Cancellation logic, idempotency key handling,
  CANCELLATION_CHANGED re-confirmation (switch resets) and test ids are unchanged. The frame's split of retained
  table amount vs platform fee/GST is not shown (the preview API returns totals only).
- Verified on the Android emulator: booked Copper Yard L02 14:00 through the seat map (SS-YDSD9BS5YU, mock payment),
  opened Manage booking -> review showed ₹250.00 full refund before 12:00; Confirm stayed disabled until the switch
  (booking still CONFIRMED), then confirmed -> CANCELLED, back on the booking with the refund in progress.
- Not done: the post-cancel "Cancellation & refund" tracking screen (94:10690) - the booking screen shows the refund
  notice instead.

Checks: lint clean; typecheck clean; `pnpm test:unit` 92 passed; `pnpm test:mobile` exported. Nothing committed.

## Step F, slice 7 - remaining native screens (20 November 2026)

- `app/support/[id].tsx` restyled to Figma "Support case detail" (94:11240): status pill, case summary, "What happens
  next" steps, conversation (read-only: the API has no customer reply yet), safety notice. Test ids kept.
- New `app/privacy.tsx` (Figma "Privacy and preferences", 94:17597), linked from Account: essential messages always
  on; email copies and offers switches saved through new api-client methods `getNotificationPreferences` /
  `setNotificationPreferences` (request helper now allows PUT); location note with a link to the area screen;
  "Request my data" (EXPORT) and "Request account closure" (DELETE, moved here from Account). The appearance setting is
  not built (no native dark theme).
- New `app/filters.tsx` (Figma "Advanced filters", 94:17429) from a "More filters" button on Discover: venue type,
  atmosphere, facilities and accessibility, sent as the existing `category`, `environment_tags`, `amenities` search
  params. Budget and food-rule filters are not built (the search API does not support them).
- Fixed in Discover: an older, slower search response could overwrite a newer one (seen as filters "not applying");
  only the latest search now updates the list.
- New `app/calendar/[venueId].tsx` (Figma "Date and time calendar", 94:17537) from a "More dates" chip on the venue
  page: month grid limited to the venue's booking window, duration, guests, free start times; "Use ..." returns
  date, duration and party to the venue page.
- `app/booking/[id].tsx`: refund tracking for cancelled bookings (Figma 94:10690): your refund (original, refunded,
  not refunded, status pill), follow-your-refund steps from the booking and refund timestamps, contact support.
- Verified on the Android emulator: refund tracker on SS-YDSD9BS5YU; contact support -> new ticket ST-HHY3Y6Q7 ->
  case screen; filters (Brewery -> 2 spaces); calendar (27 Nov back on the venue page); privacy (offers switch saved,
  then turned back off).

Checks: lint clean; typecheck clean; `pnpm test:unit` 92 passed; `pnpm test:mobile` exported. Nothing committed.

## CI run 14 e2e failure (20 November 2026)

- CI run #14 (`dfe2623`) failed in `pnpm test:e2e`; the log needs GitHub auth and `gh` is not installed here, so the
  failing test could not be read. Locally the full suite gives 54 passed / 1 failed: `smoke.spec.ts` "customer search
  shows synthetic venues" - DEMO Cafe Koramangala is pushed off the first results page because every e2e quick venue
  was created at exactly its coordinates (distance tie). The seating specs added two more such venues before the
  smoke test runs, which most likely tipped CI over too.
- Fix: `apps/web/e2e/helpers.ts` `createQuickVenue` now places venues ~140 m away (77.6255, 12.9360). Seating,
  extension and journey e2e specs still pass (13/13). The local smoke test still fails until the ~500 old local e2e
  venues are cleared (they keep the old point); CI starts from a fresh database. Confirm on the next CI run.
