# Handoff - M5 Quality

Date: 3 November 2026. Brief/plan: `BRIEF.md`, `PLAN.md`; review: `REVIEW.md`; independent review scope:
`M5.1-REVIEW-SCOPE.md`. Earlier: `tasks/archive/m4.*`, `m4-review`. Local stack and MOCK providers throughout.

## Release-candidate status

**Not a release candidate yet.** Gate (docs/06): recorded build IDs and results, no critical/high unresolved defect,
dispositions for the rest. Blocking items that this session cannot close: M5.1 independent review, real Android and
iPhone devices (iOS NOT RUN), hosted restore and provider reconciliation, real provider sandbox (D04).

Build identifiers of the checked tree (no git repository): web `.next/BUILD_ID` `yW1nIGIuVumQbrt6idBj1`; app version
0.1.0 (web, mobile, workspace); Android dev client `com.simplysit.customer.dev` (debug, emulator API 36); 25 database
migrations ending `20261103000800_m5_operational_purge.sql`.

## Results by slice

| Slice | Result | Evidence |
| --- | --- | --- |
| M5.1 Independent review | NOT RUN (needs a fresh reviewer; scope written) | `M5.1-REVIEW-SCOPE.md` |
| M5.2 UX and accessibility | Web: 0 axe WCAG 2.0-2.2 A/AA violations on 29 pages at 1440 and 320 px; no sideways scroll at 320 px; focus visible; keyboard-only booking + payment PASS. Android: labels on all tappable elements, 48 dp targets, 200% text reflows. Real screen-reader runs NOT RUN | `e2e/accessibility.spec.ts`, `evidence/m5/android-font200-*` |
| M5.3 Reliability and load | T21 latency targets met on a production build at the default 30-minute grid (p95 table in REVIEW.md); stress without think time: ~45 req/s, 0 errors; races/webhooks/leases/crash recovery PASS; query plans indexed at pilot scale | `evidence/m5/load-probe-*.md`, `worker-crash-demo.txt`, `query-plans.txt` |
| M5.4 Device and upgrade | Emulator PASS: location denied, API loss and recovery, background/foreground, deletion request, sign-out. Real devices, iPhone and old-client compatibility on devices NOT RUN | `evidence/m5/android-m54-*` |
| M5.5 Data recovery | Local restore drill 28/28 PASS (13.5 s restore + verify); expired caches purged by the worker; migrations apply forward on an empty database; M4-review/M5 migrations are additive (old app build compatible); database rollback = restore. Hosted backup/PITR restore NOT RUN | `evidence/m5/restore-drill.json` |

## What changed

- `apps/web/e2e/accessibility.spec.ts` (+ `@axe-core/playwright` 4.14.0, dev only); `lib/table-scroll.tsx` and portal
  tables wrapped; venue page shows 12 start times per table from a chosen time.
- `scripts/load-probe.mts`, `scripts/restore-drill.mjs`; `scripts/query-plans.sql` updated (M3 constraint, M4/M5 sweeps).
- `supabase/migrations/20261103000700_m5_earning_queue.sql` (queue-based earnings sweep),
  `20261103000800_m5_operational_purge.sql` (expired idempotency records, long-expired unbooked quotes); worker runs
  the purge about once a minute.
- Mobile: 48 dp Android touch targets (`minTouchTargetAndroidDp`), chip minimum width, explicit button names.
- Tests: accessibility spec (5), finance queue assertions, outbox purge test; finance coverage test made repeatable.

## Checks (3 Nov 2026, ~12:30 IST)

install, secrets, lint, typecheck, unit **70**, db:reset (25 migrations), integration **169/169** (17 files), build,
e2e **45/45** (incl. accessibility), test:mobile (Android + iOS export), expo install --check - all PASS.

## Not verified / open (owner, impact)

- Independent review (owner/reviewer; blocks release). Real devices and iOS (owner: device access, Mac/EAS).
- Hosted backup restore, PITR and provider reconciliation since backup (owner: hosted project, D04).
- Personal-data retention rules D09 (owner); screen-reader passes with TalkBack/VoiceOver/NVDA (QA).
- Mobile-web LCP and native crash-free rate need a hosted pilot (T21 remainder).
- Availability is computed per candidate start: fine at pilot grids, rewrite if 5-minute grids become common.
