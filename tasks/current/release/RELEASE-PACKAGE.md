# Release package - Simply Sit pilot (draft for owner review)

Prepared 3 November 2026 (M6, local preparation). This is the reviewable package that docs/06 M6 asks for before the
owner's final authorization. **Status: not ready to authorize.** The independent review (M5.1), owner decisions and
external accounts below are still open. Nothing has been bought, published, submitted or deployed, and no real money
has moved.

Companion documents: `SECRETS-AND-CONFIG.md` (secrets inventory without values, migrations), `RUNBOOK.md` (launch,
switches, incident, rollback, restore, daily operations, alerts), `STORE-DISCLOSURES.md` (Play/App Store privacy
drafts, payment explanation, reviewer access), `VENUE-REHEARSAL.md` (M6.1 checklist and roster).

## Build being described

| Item | Value |
| --- | --- |
| Source | `C:\Users\abhin\Desktop\Simply_Sit\build-kit` (no project git repository yet: owner to create the organization repository; release must be from a tagged commit) |
| Version | 0.1.0 (workspace, web, mobile) |
| Web build | `.next/BUILD_ID` recorded in HANDOFF (production build, `next start`) |
| Database | 26 migrations ending `20261103000900_m6_release_switches.sql` |
| Android | M6.D below |
| iOS | NOT BUILT (no Mac/EAS access) |

## Gates

Status: DONE (evidence here), READY (prepared, waiting for an owner action), OPEN (owner decision or account
missing), NOT RUN (cannot be done in this environment).

| Gate (docs/06 M6, docs/08 s.3-4) | Status | Evidence or what is missing | Owner |
| --- | --- | --- | --- |
| Independent review of money, inventory, permissions (M5.1) | OPEN | Scope `tasks/current/M5.1-REVIEW-SCOPE.md`; a fresh-session review has been proposed; `/code-review ultra` is the alternative | Owner starts it; critical/high findings block |
| Approved commercial policies: prices, fees, cancellation, no-show, extension (D02, D03) | OPEN | Proposed values only, labelled "proposed" in the UI | Owner |
| Payment provider and marketplace eligibility, settlement and refund funding (D04) | OPEN | Mock provider only; real adapter, sandbox checkout, signed webhooks and refund/settlement demonstration not built or run | Owner, then engineering |
| Release switches and rollback controls | DONE | BOOKINGS/EXTENSIONS/PAYOUTS enforced in the database, closed by default in a new database, admin page with reason/TOTP/audit; integration 6 tests, e2e 3 tests | - |
| Native compatibility / forced update | DONE | `NATIVE_MIN_VERSION`, app version header, 426 `UPDATE_REQUIRED`, app notice; bookings/receipts/support stay available | - |
| Secrets inventory without values | READY | `SECRETS-AND-CONFIG.md`; production values to be created in owner accounts | Owner |
| Migrations reviewed and applied in order | READY | 26 additive migrations; clean apply on every reset; restore drill 28/28 (M5) | Owner applies in staging, then production |
| Backups and restore (RPO 24 h / RTO 4 h) | OPEN | Local drill only; hosted backup/PITR restore and provider replay NOT RUN | Owner (hosted project), D09 retention |
| Alerts and dashboards | READY | `scripts/ops-checks.sql` (14 checks, thresholds), admin queue/finance pages; delivery channel and recipients missing; no error/crash SDK integrated (Sentry proposed in TRD) | Owner (D09), engineering |
| Daily reconciliation | READY | Admin reconciliation against the provider, payout approval blocked without a matched run; real provider listing NOT RUN | Finance, D04 |
| Support roster and hours published | OPEN | Template in `VENUE-REHEARSAL.md` s.D; Help page shows proposed text | Owner (D09) |
| Trained venues (5-10) and truthful listings | OPEN | Checklist `VENUE-REHEARSAL.md`; venues, photos and rules not yet supplied (D06, D07, D08) | Owner, operations |
| Customer web | READY | All customer journeys pass e2e on a production build (mock provider); staging deployment not done | Owner (hosting, domain) |
| Android release build | See M6.D | Debug-key signed local build only; upload key and Play internal track need the owner's Play account | Owner |
| iOS build and TestFlight | NOT RUN | No Mac or EAS access; native code is shared and the iOS export bundles (`test:mobile`) | Owner (Apple account, EAS) |
| Real-device results (Android and iPhone) | NOT RUN | Emulator results only (M5.4) | QA with devices |
| Store privacy forms and reviewer access | READY (draft) | `STORE-DISCLOSURES.md`; production app identifiers not chosen | Owner |
| Production app identifiers, scheme and domain links | OPEN | Only development and preview variants exist; `production` variant needs organization-owned IDs and a verified domain for app links | Owner |
| Canary and controlled launch | READY | `RUNBOOK.md` s.1: launch with switches closed, smoke test, open after approval, limited venues | Owner, operations |
| Account deletion, terms, private admin access | DONE | Deletion request in app and web (M5 emulator evidence), terms acceptance before booking, admin pages need a platform role and TOTP | - |
| Pilot targets and go/no-go (D10) | OPEN | Proposed PRD targets only | Owner |

## Known risks carried into the pilot

- Availability is computed per candidate start time: fine at pilot grids (30 minutes), revisit before 5-minute grids
  at scale (M5 Q5).
- One intermittent partner e2e test seen once in M4 (M5 Q6); not reproduced since.
- Screen-reader passes with TalkBack/VoiceOver/NVDA, mobile-web LCP and native crash-free rate need real devices or
  the hosted pilot (M5 Q7, Q8).
- No error/crash reporting SDK yet: production errors would only be visible in hosting logs until one is added.

## M6.D Android release build

Pending: filled in when the local release build finishes.
