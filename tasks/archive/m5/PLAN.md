# M5 plan: quality

Written 3 November 2026. M4 records: `tasks/archive/m4.1`-`m4.6`, `m4-review`.

1. M5.2 accessibility: add `@axe-core/playwright` (dev only, 4.14.0); `apps/web/e2e/accessibility.spec.ts` scans public,
   customer, partner and admin pages (WCAG 2.1 A/AA rules) at desktop and 320 px, plus 200% zoom (640 px CSS width) and
   a keyboard-only hold-and-pay flow. Fix every violation found. Android: font scale 2.0 screenshots of key screens,
   check labels on controls (uiautomator), touch targets >= 48dp.
2. M5.3 reliability: `scripts/load-probe.mjs` against `next start` (production build) with 50 concurrent sessions
   (search, venue detail, availability) and 10 concurrent hold+checkout+verify flows; report p50/p95/max and errors.
   Re-run the concurrency, webhook and worker-crash checks and record them. Query plans (`pnpm db:plans`).
3. M5.5 recovery: `scripts/restore-drill.mjs`: dump the local database (schema + data + storage metadata) and the
   storage objects, restore into an isolated database, verify counts, balanced ledger, booking/finance/audit links,
   time each step. Verify privacy deletion/retention job. Migration forward test (all migrations on an empty database)
   and an application rollback check (previous app build against the current schema).
4. M5.4 devices (emulator): background/foreground during payment, network off/on, location permission denied,
   sign-out and deletion request; record as emulator evidence, real devices NOT RUN.
5. M5.1: write the review scope; the independent review itself needs a fresh reviewer.
6. Full checks, HANDOFF with release-candidate evidence and dispositions.
