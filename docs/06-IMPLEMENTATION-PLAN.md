# Simply Sit implementation plan

Prepared 25 October 2026. Build a hospitality marketplace with customer web and Android/iOS apps together, plus partner/staff/admin web portals. This sequence makes booking correctness and operational readiness the checkpoints for every client. It is an implementation specification; no application tasks below have been executed.

## Ownership and planning assumptions

The product owner owns commercial terms, policies, vendor accounts and release decisions. A technical lead owns architecture and schema review. A web/backend engineer and a mobile engineer implement paired vertical slices. A designer and QA engineer work part time across milestones. A venue operations owner recruits and trains 5-10 partners. Claude Code may perform engineering tasks under the same boundaries, with human technical review for financial and inventory correctness.

Recommended staffed schedule: 22 weeks, with venue recruitment, provider onboarding, store account registration and policy review starting in week 1. Dates are an illustrative recommendation assuming a 2 November 2026 start, not a delivery commitment. Budget and city reasoning is in document 09.

| Milestone | Indicative weeks | Deliverable |
| --- | --- | --- |
| M1 Project setup | 1-3 | Runnable monorepo, web and native shells, CI and local services |
| M2 Data and auth | 4-6 | Migrations, tenant permissions, account lifecycle and inventory foundation |
| M3 Core user journey | 7-12 | Search through verified payment and check-in on web and native |
| M4 Secondary features | 13-16 | Extensions, cancellations, refunds, partner/admin operations and support |
| M5 Quality | 17-19 | Device, security, accessibility, race, load and recovery evidence |
| M6 Release | 20-22 | Staged beta, store readiness, reconciled pilot and rollback drill |

## Milestone 1 Project setup

Inputs: PRD, TRD, design brief, decision register, current kit and official supported SDK requirements. Dependencies: none. Provisional choices permit local development. Owner decisions and service onboarding proceed in parallel.

| Task | Owner | Output and definition of done | Dependency |
| --- | --- | --- | --- |
| M1.1 Inspect and plan | Lead or Claude | Inventory existing files and git state; create per-slice PLAN naming actual paths; preserve source documents and unrelated changes; record confirmed versus proposed choices | None |
| M1.2 Workspace | Web/backend and mobile engineers | pnpm workspaces; Next.js app/API; Expo app; worker; shared contracts/tokens; pinned compatible versions and lockfile; no credentials | M1.1 |
| M1.3 Run and preview | Engineers and designer | Customer search shell, role portal shells and native navigation run; brand tokens applied; loading, empty and error examples; preview uses labelled synthetic venues | M1.2 |
| M1.4 Delivery pipeline | Lead | CI install/lint/typecheck/unit/build; staging configuration template; separate native development profiles and bundle IDs; secret scanning; exact scripts recorded in context | M1.2 |
| M1.5 Account and pilot readiness | Owner and operations | Provider eligibility inquiry, app-store organization account checklist, venue interview plan and draft terms; record dependencies without pretending approvals exist | M1.1 |

Gate: start web and worker locally, open Android development build and an iOS development build or record the specific native access blocker, inspect responsive shell, run configured checks, and update HANDOFF. An iOS blocker must have a named owner and resolution path before M3 parity is called complete. Do not claim signed builds from a browser preview.

## Milestone 2 Data and auth

Inputs: backend schema, API contract, account/session requirements and threat model. Dependency: M1 runnable foundation.

| Task | Owner | Output and definition of done | Dependency |
| --- | --- | --- | --- |
| M2.1 Migrations and seed | Backend engineer | Versioned constraints/indexes/functions/RLS; synthetic 5-10 venue fixtures with hours, rules, resources and prices; migration applies from empty local DB and upgrades previous schema | M1 |
| M2.2 Authentication | Web and mobile engineers | Email OTP proposed; verified session lifecycle on both clients, deep links/redirect allowlist, secure native storage, signout, account deletion request; admin/staff MFA | M2.1 |
| M2.3 Authorization | Backend and independent reviewer | Customer ownership, venue memberships, staff/manager distinctions, admin capabilities and private storage policies; direct API and RLS cross-tenant attempts denied | M2.1-M2.2 |
| M2.4 Inventory and pricing engine | Backend engineer | Server time/amount validation; versioned policy snapshots; common locking order; blackout claims and exclusion constraint; race tests use actual PostgreSQL | M2.1 |
| M2.5 Async infrastructure | Backend engineer | Durable outbox, retries/backoff, idempotent consumers, hold expiry and heartbeat metrics; worker crash recovery demonstrated | M2.1 |

Gate: run web/native sign-in and permission-denied paths; reset local database safely; verify isolation, timezone boundaries, immutable price/policy snapshots and conflicting holds. Record accepted script results. Never reset production to prove migrations.

## Milestone 3 Core user journey

Inputs: screen/action inventory, API contracts, schema, design tokens and sandbox provider credentials when available. Dependency: M2. Search/list may be built alongside M2 after contracts stabilize; confirmation may not bypass M2 safeguards.

| Task | Owner | Output and definition of done | Dependency |
| --- | --- | --- | --- |
| M3.1 Discovery | Web and mobile engineers | Manual location and permission-based search; list/map, venue categories, amenities, party size, date/time, duration; verified public data only | M2.1; M2.4 |
| M3.2 Venue and quote | Engineers and designer | Photos, directions, food/delivery/house rules, resource capacity, price breakdown, cancellation cutoff and timezone; stale quotes refresh visibly | M3.1 |
| M3.3 Holds | Backend and client engineers | Atomic resource hold with expiry; idempotency and busy state; simultaneous customer attempts return one winner; client countdown uses server deadline | M2.4-M2.5; M3.2 |
| M3.4 Payment adapter | Backend and mobile engineers | Order creation, web checkout and native development-build SDK integration; signed webhook inbox; verify capture amount/currency/order; pending and late-success recovery; test mode labelled | M3.3 |
| M3.5 Confirmation and arrival | Engineers and operations | Confirm only trusted committed reservation; booking detail/receipt/reference, own booking history, opaque QR or PIN; venue-scoped check-in/out, audit and cleanup readiness | M3.4 |
| M3.6 First full parity check | QA | Same customer books on web, sees it on Android/iOS, returns from provider app/browser, survives process death and checks in with staff; no duplicated charge or booking | M3.1-M3.5 |

Gate: demonstrate discovery to checked-in state on all three customer surfaces and staff web, plus payment failure, unknown status, offline recovery, expiry and concurrent checkout. If credentials are absent, complete contract tests and clearly label provider integration unverified; do not pass the real payment gate.

## Milestone 4 Secondary features

Inputs: completed core journey, snapshot policy logic, extension state machine and admin permissions. Dependency: M3.

| Task | Owner | Output and definition of done | Dependency |
| --- | --- | --- | --- |
| M4.1 Cancellation and refund | Backend and clients | Preview accepted-policy refund; idempotent cancellation/refund intent; asynchronous provider states; repeated admin/customer requests cannot over-refund; full venue-cancel liability | M3 |
| M4.2 Extension | Backend and clients | Staff decision, expiry, refreshed quote, atomic extension hold, captured incremental payment, revised end/reminder; failure preserves original booking | M3; M4.1 |
| M4.3 Partner operations | Web engineer and operations | Onboarding review, profile/rules/images, opening hours, exclusive table inventory, blackouts, calendar and role-limited staff invites; conflicting closure returns 409, manager pauses new sales, resolves affected bookings explicitly, then retries closure | M3 |
| M4.4 Finance and admin | Backend and web engineer | Permissioned refunds, fee versions, ledger/reconciliation, partner statement/export and payout states; no payout marked paid without provider/bank evidence; negative adjustment handling | M4.1; M4.3 |
| M4.5 Support and reviews | Engineers and operations | Eligible review creation/moderation, own support tickets, confidential incidents and contact escalation; staff sees only necessary data | M3.5 |
| M4.6 Notifications and analytics | Engineers | Durable in-app/email messages; confirmation/refund/reminder events deduplicated; metric definitions instrumented without raw location/contact data. Native push is deferred pending provider, consent and device-token design | M2.5; M4.1-M4.5 |

Gate: verify end-to-end cancellation, extension contention, partner closure, incident access and reconciled partner statement. Staff must mark a cleaned table ready before the next arrival can check in. Do not make reminder delivery a condition of a booking ending.

## Milestone 5 Quality

Inputs: feature-complete staging, test fixtures, threat model and document 08 matrix. Dependency: M4. These checks supplement focused tests already run during implementation.

| Task | Owner | Output and definition of done | Dependency |
| --- | --- | --- | --- |
| M5.1 Independent review | Reviewer | Evidence-based findings for auth, tenancy, resource locks, price/policy state, refunds and provider retries; fix and retest all critical/high issues | M4 |
| M5.2 UX and accessibility | Designer and QA | Keyboard, contrast, screen-reader labels, 200% web zoom, native font scaling, touch targets, calendar alternatives and payment recovery verified | M4 |
| M5.3 Reliability and load | Lead and QA | Measured pilot SLOs; concurrent reservation/closure/extension tests; delayed webhook replay; worker restart, duplicate jobs and rate-limit behavior | M4 |
| M5.4 Device and upgrade | Mobile engineer and QA | Real Android and iPhone sign-in, payment return, background/foreground, permission denial, intermittent network, logout/deletion and old-client API compatibility | M4 |
| M5.5 Data recovery | Lead | Staging restore from backup with measured RPO/RTO; redaction/retention jobs verified; migrations tested forward with compatible application rollback | M4 |

Gate: release candidate has recorded device/build IDs and test results; no critical/high unresolved defect; remaining issues have owner, impact and release disposition. Automated test success does not replace provider/device/restore evidence.

## Milestone 6 Release

Inputs: quality evidence, approved commercial policies, real provider eligibility and organization-owned accounts. Dependency: M5 and external readiness.

| Task | Owner | Output and definition of done | Dependency |
| --- | --- | --- | --- |
| M6.1 Operational rehearsal | Operations and QA | Train 5-10 venues; verify hours/photos/rules, arrival QR, cleaning, closed-venue incident and refund escalation; contact roster and support hours published | M5 |
| M6.2 Beta distribution | Mobile and web engineers | Staging web plus Android internal test and iOS TestFlight; physical-service payment explanation and reviewer access; privacy/data safety forms match actual SDK behavior | M5 |
| M6.3 Production preparation | Lead and owner | Separate secrets, webhook endpoints, app identifiers, backup policy, dashboards/alerts, domain links and release switches; owner reviews concrete release package | M6.1-M6.2 |
| M6.4 Controlled launch | Owner, lead and operations | Apply reviewed migrations before compatible app rollout; limited service polygon and capacity; sandbox off only after canary financial reconciliation; store approvals obtained | M6.3 |
| M6.5 Observe and decide | Operations and product | Daily provider/ledger reconciliation; booking and partner incident review; four-week pilot report and expansion decision using PRD metrics | M6.4 |

Release checklist: current terms/rules visible; working support; customer account deletion; private admin access; reliable jobs; signed and verified provider callbacks; store payment return; all customer platforms available; venue readiness verified; actual refund and settlement demonstration. Account eligibility and review timing are external dependencies, not guaranteed completion dates.

## Rollback and incident procedure

For inventory conflict or uncertain payment state, disable new checkout by server flag while preserving booking lookup, existing arrivals and refunds. Stop payout release if reconciliation fails. Revert compatible application deployments; use forward-fix migrations for committed business data. Mobile clients already installed cannot be rolled back instantly: keep API compatibility for at least the previously released version and use a server feature switch for dangerous mutations. Any forced update must preserve receipt/support access.

Name an incident owner; collect redacted request/event IDs, preserve ledger/audit evidence, resolve customer service, and reconcile before re-enabling. Restore backups only through the documented recovery procedure with provider event replay and deduplication, since restoring a database cannot undo external charges.

## Mandatory checkpoint record

For each task record owner, input versions, actual changed paths, output, acceptance IDs, commands with pass/fail/not run, manual web/native evidence, unresolved issues, next dependency and rollback. Refresh `tasks/current/PLAN.md`, `HANDOFF.md` and `REVIEW.md`. Before moving on, run the app and verify criteria. If a check cannot run, record why and continue only independent work; never silently mark the milestone complete.
