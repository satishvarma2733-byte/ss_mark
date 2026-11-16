# Claude Code milestone prompts

Use one prompt per checkpoint with the detailed tasks in document 06.

## Milestone 1 Project setup

```text
Implement M1 from docs/06-IMPLEMENTATION-PLAN.md. Inspect files and instructions first. Create customer web/API, Expo customer mobile, worker and shared contracts/tokens in a compatible pinned monorepo. Establish local services, synthetic fixtures, scripts and CI. Update PLAN before edits; run the app and checks; record web URL, actual native build status and unverified checks in HANDOFF. Stop at the M1 checkpoint.
```

## Milestone 2 Data and authentication

```text
Verify the prior handoff against files and implement M2. Read backend schema and API/state specs. Create reviewed migrations, constraints, indexes, RLS and synthetic seeds; implement web/native authentication and server roles. Build atomic exclusive inventory and durable jobs. Test real PostgreSQL conflicts, cross-venue access denial, policy snapshots and session recovery. Never bundle server keys. Run the app and checks, update evidence, and stop at M2.
```

## Milestone 3 Core journey

```text
Implement M3 in vertical slices across customer web, Android and iOS, plus staff web arrival. Follow PRD, flow, design, API and schema. Deliver manual/location search with list/map, venue rules, quote, atomic hold, payment adapter, committed confirmation and check-in. Label mock/sandbox mode. Verify sandbox native SDK and signed webhook behavior when credentials exist. Test simultaneous checkout, expiry, duplicate events, wrong amounts, late capture, pending/offline recovery and native provider-return/process-death recovery. No client confirms payment. Record per-platform evidence before M3 is complete.
```

## Milestone 4 Secondary features

```text
Implement M4: policy cancellation/refunds, staff-approved extension followed by atomic payment hold, partner onboarding/profile/inventory/calendar/staff, restricted finance/reconciliation, reviews/support/incidents and deduplicated notifications. Failed extension preserves the original booking. Refund submission stays pending until verified. Reconcile partner liabilities and statements. Exercise success, permissions, retries and errors on web/native; record evidence and stop at M4.
```

## Milestone 5 Quality

```text
Execute M5 and docs/08-TEST-AND-RELEASE-PLAN.md against actual code. Obtain independent review of money/inventory/permissions. Verify Android/iPhone payment return and session storage, web keyboard/zoom/contrast, RLS, concurrency, duplicate jobs, delayed webhooks, load and backup restore. Fix evidenced defects and rerun affected checks. Mark unavailable checks NOT RUN with impact/owner. Produce release candidate evidence; no production-ready claim with critical gates unverified.
```

## Milestone 6 Release preparation

```text
Complete M6 preparation. Assemble a concrete release package: approved policies, provider eligibility, signed artifacts, store reviewer access/privacy forms, device results, migrations, secrets inventory without values, trained venues, support roster, alerts, reconciliation, canary and rollback. Include customer web, Android and iOS. Do independent local/staging work within current authorization. Ask required final authorization only when the reviewable package is ready. Do not buy accounts, move real funds, publish or submit externally without authorization. Record completed and pending gates.
```
