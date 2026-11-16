# Handoff - M4.3 Partner operations

Date: 2 November 2026. Root: `C:\Users\abhin\Desktop\Simply_Sit\build-kit`. Brief/plan: `BRIEF.md`, `PLAN.md`; review:
`REVIEW.md` (author self-review; independent review NOT yet performed). M4.1 records: `tasks/archive/m4.1/`.

## Status

Done locally (web portals + API; customer photos also on Android):

- P01 apply -> DRAFT venue, PENDING partner, OWNER membership. P03 profile, rules (one draft; live venues send rule
  changes for review), "good for"/atmosphere/amenities, photos (private until approved). P04 tables with prices
  (new rate versions apply to new quotes only), pause/resume/retire, opening hours (new schedule version), blackouts.
  P05 day calendar per table. P06 booking view with no-show (after grace) and service cancellation (managers). P08
  invitations by email (accept by signing in with that email; nothing secret emailed), revocation. P02 home with
  invitations, listing status and what is missing, today's bookings and table readiness.
- A02 review queue and detail: approve (publishes the policy draft and pending photos), request changes, reject,
  pause (lists affected future bookings, cancels nothing), resume; live-venue rule changes and photos reviewed
  separately. All with reason + TOTP + audit.
- Closure recovery (T12): a blackout over a hold/booking is refused with its reference; the manager pauses the
  table (new holds refused at once, existing bookings untouched), cancels the booking for the customer (full refund,
  M4.1), then the blackout saves. Same 409 pattern for hours and capacity changes.
- Photos: `venue-media` bucket made private (`supabase/config.toml`); Storage policies + `GET /api/v1/media/{id}`
  proxy apply the same rule as the database (approved + published = public; else venue members and support only);
  uploads checked by content (JPEG/PNG/WebP, 5 MB) and written with the manager's own token (no service key).

## What changed

- `supabase/migrations/20261103000100_partner_operations.sql` (status reasons, invitations table, ~35 functions,
  storage policies, `app.my_memberships`), `supabase/config.toml` (bucket private).
- `packages/contracts` (partner/admin schemas, `INVITATION_EXPIRED`, venue `photos`), `packages/db/src/partner.ts`,
  `getMe` uses `app.my_memberships()` (an owner without TOTP still sees their draft venue name; prices/bookings stay
  TOTP-gated).
- `apps/web`: `lib/route.ts` (shared authenticated route), `lib/media.ts`, `lib/use-action.ts`, `lib/partner-page.tsx`,
  `lib/partner-types.ts`; ~30 API routes under `/api/v1/partner`, `/api/v1/admin/{venues,policies,media}`,
  `/api/v1/invitations`, `/api/v1/media/{id}`; pages `/partner`, `/partner/{apply,venue,inventory,calendar,staff}`,
  `/partner/bookings/[id]`, `/admin/venues`, `/admin/venues/[id]`; venue page shows photos; portal loading screens.
- `apps/worker`: `booking.no_show` and `invitation.created` (mock email) handlers.
- `apps/mobile`: venue screen shows approved photos.
- Tests: `tests/integration/partner-operations.test.ts` (10), `apps/web/e2e/partner.spec.ts` (3), auth e2e updated
  for the new `/partner` entry, `lateWindowSlot` helper (cancellation tests no longer fail after ~22:00 IST).

## Checks (2 Nov 2026, last code state)

| Command | Result |
| --- | --- |
| install, secrets, lint, typecheck | PASS |
| `pnpm test:unit` | PASS - 11 files, 65 tests |
| `pnpm db:reset` | PASS - 18 migrations + seed |
| `pnpm test:integration` | PASS - 13 files, 137 tests |
| `pnpm build` | PASS |
| `pnpm test:e2e` | **32/32** (after updating the two M2 auth tests whose expectation of `/partner` changed by design) |
| `pnpm test:mobile`, `expo install --check` | PASS |

Evidence screenshots: `tasks/current/evidence/m4/web-m43-01..11-*.png` (apply, draft gaps, inventory, submitted,
admin review, public listing with photo, closure conflict, service cancel, calendar, staff, invitation).

## Not verified / open

- iOS: NOT RUN. Native photo display not run on the emulator (bundle export only).
- Real email delivery of invitations (mock provider records only).
- Independent review of M4.3 permission code: NOT performed.
- Owner decisions: whether venue cancellations need platform approval or affect ranking; photo rights/consent wording.
- Partner reports/statements and payout onboarding are M4.4.

## Rollback

Delete the migration, revert `supabase/config.toml` bucket privacy, `pnpm db:reset`; the routes/pages are additive.
