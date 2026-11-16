# Current review checkpoint

Scope: Milestone 1 local foundation only (workspace, shells, contracts, design tokens, synthetic data, worker skeleton, local database configuration). M1 contains no booking, inventory, payment, refund, auth or permission logic, so the money/inventory/tenancy review areas in the implementation plan do not yet apply.

Reviewed revision: working tree at the end of M1 on 25 October 2026. No git commit exists (see HANDOFF).

Independent review: **not performed.** The author ran the checks listed in `HANDOFF.md`; no second reviewer has read the code.

Evidence available for review:
- Lint, typecheck, unit (24), integration placeholder (1 test + 2 todo), production web build, Playwright e2e (4), Expo Android and iOS export: all passing as recorded in HANDOFF.
- Screenshots at phone and desktop widths reviewed by the author; not reviewed by a designer.

Gap-closure additions (same day) that a reviewer should read first:
- `packages/providers/src/env.ts` - fail-closed environment schema and the public-variable secret check. Confirm the name/value patterns are adequate; they are a guard, not a scanner.
- `packages/providers/src/mock.ts` - mock payment idempotency (same hold returns the same order; a different amount is refused) and `unknown` status for unseen orders. These mocks prove application logic only, never provider readiness (docs/08).
- `packages/domain/src/policy.ts` - frozen, versioned proposed policy; unknown versions throw.
- `eslint.config.mjs` - `no-restricted-imports` keeps `@simply-sit/domain` and `@simply-sit/providers` out of mobile and client packages. It does not cover web `"use client"` modules; that needs a separate check in M2.
- `apps/mobile/app.config.ts` - development and preview variants only; production fails closed until organisation-owned identifiers exist.

Known review points for M2 and later:
- Partner, staff and admin pages are unauthenticated preview shells. They must not be deployed publicly before M2 auth and role checks.
- The worker has no persistence. Its mock queue must not be mistaken for the outbox in M2.
- `apps/mobile/lib/venues.ts` will call the API when `EXPO_PUBLIC_API_URL` is set. No server endpoint currently requires sign-in, so nothing private is exposed yet.
- Local Supabase keys printed by `supabase start` are development defaults. They were not copied into any project file. Do not reuse them outside this machine.
- Changes to `.gitignore` and `scripts/check-secrets.mjs` were made during M1 and should be reviewed for coverage.

Limits: no accessibility audit, no device testing, no load testing, no security review. Planned tests are not passing tests.
