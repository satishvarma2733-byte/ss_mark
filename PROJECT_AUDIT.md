# SimplySit — Project Audit

**Audited:** 16 November 2026 (replaces the 14 November audit; history is in `tasks/current/HANDOFF.md`)
**Repository root:** `Desktop\Simply_Sit\build-kit` (no git commits exist yet; the enclosing git repo is the home directory)
**Figma source of truth:** file `DA7i1rigZ1Mjb0lLX7ndV2` ("simply-sit (Copy)"), 18 pages, read access confirmed on 16 November

Statuses in this file mean: **Verified** = checked on the audit date; **Recorded** = taken from an earlier handoff and not re-run.

---

## 1. Architecture

`pnpm@9.15.9` workspace, Node `>=22.13 <27`, TypeScript `5.9.3`.

| Part | Path | Stack |
| --- | --- | --- |
| Web + API | `apps/web` | Next.js `16.4.3` App Router, React `19.3.0`, `@supabase/ssr`, `lucide-react`, `qrcode`. 47 pages, 99 API route files under `app/api/v1` |
| Native app | `apps/mobile` | Expo Router, 18 screen files (customer only) |
| Worker | `apps/worker` | Durable outbox / job loop |
| Shared | `packages/*` | `contracts`, `domain`, `db`, `api-client`, `payments`, `providers` (MOCK gateway only), `design-tokens`, `synthetic-data` |
| Database | `supabase/migrations` | 27 SQL migrations, row-level security, Supabase Auth (email OTP + TOTP for portals) |
| Tests | `tests/integration` (18 files), `apps/web/e2e` (13 specs + accessibility scan), unit tests beside code |

State management is server components plus small client components (`lib/use-action.ts`, `lib/client-api.ts`); there is no client store. Routing, auth gates and permissions are server-side (`lib/portal.ts`, `lib/route.ts`, `proxy.ts`, RLS).

## 2. Health checks

| Check | Command | Result (16 Nov) |
| --- | --- | --- |
| Typecheck, all 11 projects | `pnpm typecheck` | **Verified pass** |
| Lint | `pnpm lint` | **Verified pass** (0 errors, 0 warnings) |
| Unit tests | `pnpm test:unit` | **Verified pass** — 14 files, 79 tests |
| Web build | `pnpm --filter @simply-sit/web build` | Recorded pass (14 Nov) |
| Integration tests | `pnpm test:integration` | Recorded pass (14 Nov) — 18 files, 175 tests. **Not re-run: local Supabase containers are stopped** |
| End-to-end | `pnpm test:e2e` | Recorded 47/48 on the full run, with the smoke spec passing on re-run (14 Nov). **Not re-run** |
| Native app export / device run | `pnpm test:mobile`, emulator | **Not run** in this audit |

## 3. What is implemented

**Customer web:** discovery and search (`/`, `/venues`), venue detail with gallery (`/venues/[id]`), table and time (`/venues/[id]/book`), checkout (`/checkout/[bookingId]`), payment return, booking pass with QR and PIN (`/bookings/[id]`), history, extension, cancellation with refund tracking, review, notifications, account, MFA, help and support cases, sign-in by email code.

**Partner and staff web:** today, calendar, inventory, closures, venue profile and photos, booking detail with check-out and turnover, payouts, reports, staff, incidents, partner application, staff arrivals with PIN/QR check-in.

**Admin web:** overview, venue review, bookings, finance (ledger, fees, refunds, reconciliation), reviews, support, metrics, release switches, plus `/admin/audit`, `/admin/customers`, `/admin/users` added on 14 November.

**Backend:** booking holds with database-enforced exclusive inventory, quotes, mock checkout with signed webhooks and idempotency, cancellation and refund state, extensions, payouts and reconciliation, notifications outbox, rate limiting (`lib/rate-limit.ts`), audit of sensitive actions, release switches, native minimum-version gate.

**Design system:** Figma light and dark tokens in `packages/design-tokens` and `globals.css`, theme toggle, 26 primitives in `apps/web/components/ui/`, interaction "polish layer" (12 November).

## 4. Gaps found in this audit

### Design system and UI
1. **UI kit adoption** — largely resolved 16 Nov: 68 files import `components/ui`. Buttons, button-links, cards, static status pills and link chips now come from the kit, which renders the existing Figma-matched classes, so there is one look. Still class-based: form fields (`.input`, about 99 uses), notices (about 65), status pills with computed tones (about 22), label/checkbox chips.
2. **Kit completeness** — resolved 16 Nov: `Card`, `StatusPill`, `FilterChip`, `Tabs`, `DatePicker`, `TimeSelector`, `QrBookingCard` and `ButtonLink` added. `Tabs` has no page using it yet.
3. **Dark mode** — resolved 16 Nov: hard-coded colours replaced with role tokens (only the QR, scanner and mock-gateway banner stay fixed), 30 routes pass axe contrast in dark, and the accessibility spec now has a dark-mode test. Not yet compared frame by frame with Figma page `12 — Dark Mode`.
4. **Stylesheet size:** `globals.css` is 4,528 lines plus `ui.css` 640 lines, with layered overrides.

### Screens
5. **Recovery states** (payment pending, failed, hold expired, slot unavailable, extension unavailable; Figma `94:16726`–`94:17030`): a `RecoveryBanner` exists but no page uses it yet.
6. **Notification preferences** (`94:22428`) and **privacy and preferences** (`94:17597`): no page. Account has privacy requests only.
7. **Partner and admin notification centres** (`94:21953`, `94:22194`): the portal bell opens the customer `/notifications` page.
8. **Partner arrival progression** (scan → checked in → cleaning → ready, `94:19115`–`94:19848`) and **partner support centre** (`94:18856`): partial.
9. **Admin:** partner-and-venue management beyond the review queue, system settings beyond release switches, secure admin access screen — partial.
10. **Native app:** 23 mobile frames on Figma page 06. All have a matching Expo screen file except gallery, advanced filters and calendar, but only about a third were restyled (work stopped on 9 November) and none were checked on a device since.

### Production readiness (cannot be closed by code alone)
11. **Payments are MOCK only.** No real gateway adapter exists (`packages/providers` has `mock-gateway.ts` only). Owner decision D04 (provider, settlement and refund funding) is open.
12. **No SMS or email provider** beyond local Mailpit; sign-in is email code, while Figma shows phone/SMS.
13. **Commercial policies** (prices, fees, cancellation, extension: D02, D03) are "proposed", and the UI labels them so.
14. **No hosted environment:** no production Supabase project, hosting, backups/restore drill on hosted data, alert delivery, or error-reporting SDK.
15. **Environment templates exist** at `config/.env.example` and `config/.env.staging.example` (no values); local values are generated by `pnpm env:local`. Not a gap (corrected 16 Nov).
16. **Nothing is committed to git.** There is no history to roll back to; the only backup is `../backups/pre-figma-v2-2026-11-09/apps.tar`.
17. **Independent review M5.1** of payment, permission and concurrency code is still outstanding (`tasks/current/M5.1-FINDINGS.md`).

## 5. What must not change

Database-enforced inventory, trusted payment verification, idempotent webhooks, immutable price and policy snapshots, tenant-scoped permissions, audit of sensitive actions, visible labelling of mock output, existing API contracts and e2e selectors. See `CLAUDE.md` and `docs/07-API-AND-STATE-MACHINES.md`.
