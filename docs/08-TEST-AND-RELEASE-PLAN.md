# Test and release plan

Status: **NOT RUN**. This is a verification specification for the proposed build, not a test report. No application, live gateway, production environment, migration execution, backup or restore is evidenced by this document. Owners: implementation agent builds evidence; independent reviewer checks it; product/operations owner approves pilot policy and live readiness.

## 1. Fixtures and evidence

Seed fictional staging data: two isolated venue organizations, two tables of different capacity per venue, approved/unpublished/closed venues, normal/overnight hours, customer A/B, staff and managers per venue, support/finance administrators, inactive memberships and a disabled account. Include cleaning, overlapping future reservations, a frozen historical policy and a changed current policy. Use the fake payment adapter for deterministic failures; verify actual adapter behaviour separately in the selected provider's sandbox. Never use real customer records or live funds as test fixtures.

For every run record commit, environment, migration version, fixture version, command/browser/device, timestamp, result and evidence location in `tasks/<task>/HANDOFF.md`. Reproduce a failure before fixing it. A mocked provider result proves application logic only; live-provider readiness requires sandbox integration evidence. Mark skipped gates **NOT RUN** with reason and owner.

## 2. Acceptance verification matrix

Requirement IDs below map to the PRD feature/acceptance table. `U` = unit, `I` = real PostgreSQL integration, `E` = web/native end-to-end, `O` = operational rehearsal. Every row starts **NOT RUN**.

| Test | PRD behaviour | Scenario and observable result | Level |
| --- | --- | --- | --- |
| T01 | PRD-02, PRD-03; AC-01, AC-02 | Deny location permission, search manually/list/map/filter, inspect capacity, amenities, food/delivery restrictions and exact price; no forced purchase or permission loop. | E |
| T02 | PRD-01; AC-14 | Expired/reused OTP, resend abuse, safe redirect, logout and disabled account; only verified active identity can hold inventory. Distinct Auth/profile IDs map correctly; eligible Auth deletion preserves anonymized finance links. | I/E |
| T03 | PRD-03, PRD-04 | Reject over-capacity, past/closed/off-grid slots and invalid duration. Check overnight hours, UTC/local display, paise rounding and quote expiry. | U/I/E |
| T04 | PRD-04; AC-03 | Start ten checkout requests at a barrier against one table/interval; exactly one active claim commits and others get recoverable conflicts. Query invariant directly. | I |
| T05 | PRD-04, PRD-05 | Test start/end boundaries, buffer conflicts and precise expiry instant with database-controlled time; expiry never depends solely on the worker. | I |
| T06 | PRD-05; AC-04 | Client-success spoof, wrong amount/currency/order/environment and authorized-only payment cannot confirm. Correct verified capture produces one confirmation. | I/E |
| T07 | PRD-05; AC-05 | Duplicate/reordered events, repeated checkout and abandoned return produce one allocation. Failed then successful attempts under one order retain separate IDs; extra captures create full refund liabilities. Invalid signatures create no trusted transition. | I/E |
| T08 | PRD-05; AC-05 | Expire A's hold, let B reserve, then deliver A's valid capture; B stays booked, A sees refund pending and one refund liability/job exists. | I/E |
| T09 | PRD-06; AC-06 | Check immediately before/at/after two-hour boundary against the accepted historical policy. Cancellation releases safely; provider pending never appears refunded. | U/I/E |
| T10 | PRD-06; AC-06 | Timeout after provider accepts refund, then retry/reconcile; never issue a duplicate refund or over-refund captured amount. | I |
| T11 | PRD-08; AC-08 | Race extension against the next booking/closure. Staff decides within request+5min; approval allows hold creation within decision+5min; hold expires creation+5min capped at original end. Earlier deadlines cannot shorten a created hold. Reject expired decisions/payments; original end remains until timely capture commits. | I/E |
| T12 | PRD-07, PRD-09; AC-07, AC-09 | Closure race returns overlap conflict with permitted booking references. Manager pauses affected sales, resolves bookings explicitly, then retries closure; no silent cancellation or false saved state. Staff check-in/out is scoped/audited; unapproved venues cannot publish. | I/E/O |
| T13 | PRD-07; AC-07 | Checkout sets cleaning; only staff ready permits arrival. Buffer expiry never marks ready. No-show does not silently resell the interval or extend the paid end. | I/E/O |
| T14 | PRD-01, PRD-09, PRD-10; AC-12, AC-14 | Forged roles, guessed UUIDs, direct database/API/storage calls and another venue's QR are denied. Staff cannot read finance/contact details or grant roles. | I/E |
| T15 | PRD-10, PRD-13; AC-10, AC-13 | Reasoned admin/support actions are audited. Only the booking owner may review once after completion; abuse reports and moderation preserve evidence. | I/E/O |
| T16 | PRD-11; AC-11 | Kill worker after commit/during delivery; retry leases recover. No lost confirmation, duplicate financial action or premature notification; dead-letter alert works. | I/O |
| T17 | PRD-12; AC-12 | Match captured, pending, refunded, disputed and fee totals against fixture statements; inject mismatch, alert and freeze affected payout. | I/O |
| T18 | PRD-12 | Compare occupancy, conversion, GBV/refunds and repeat measures with known totals; retries do not double-count events. | I |
| T19 | PRD-02, PRD-05, PRD-06 | Empty results/slots/bookings, expired session, denied permission, gateway outage and lost network preserve inputs and show recovery without false success. | E |
| T20 | All customer/staff journeys | At 320/375/768/1440px and 200% zoom, keyboard/screen reader can complete critical web flows. On iOS/Android test text scaling, screen reader, focus and large touch targets. | E/manual |
| T21 | TRD performance and alerts | At 50 sessions/ten checkouts, measure p95 search/detail <1s, mutations <1.5s excluding provider, mobile-web p75 LCP <2.5s and native screen p95 ready <2s in documented profiles. Induce alerts; measure native crash-free target >99.5% over the pilot observation window. | I/O |
| T22 | Restore and rollback | Restore isolated backup and required storage, recover booking/finance/audit links, reconcile provider events since backup; rehearse compatible application rollback. Record achieved RPO/RTO. | O |
| T23 | PRD-01, PRD-05, PRD-06; AC-15 | Web, Android and iOS share prices, policies and booking status. Secure session persistence, background/kill/reopen, expired hold, checkout return/deep link, forged callback and logout reveal no token or false confirmation. | I/E |
| T24 | First-release platform gate | Signed Android/iOS release candidates on real devices, provider sandbox checkout, owner-controlled signing/accounts, privacy/support/deletion flows and current store-review requirements have recorded evidence. Track both store approvals and web release. | E/O |

Use real database transactions in T04–T14; browser tests alone cannot prove non-overlap or row-level security. Run closure/expiry/capture/extension races in both event orders with repeatable synchronization, not arbitrary sleeps. Add exact GWT acceptance IDs to each test's implementation.

## 3. Milestone gates

| Gate | Required proof before continuing |
| --- | --- |
| M1 setup | Reproducible install, shared TypeScript contracts, local Next.js web and Expo Android/iOS apps, environment validation, CI, staging web preview and device builds. Package scripts do not exist yet. |
| M2 data/auth | Clean migration and upgrade path, seeded tenants, ownership/RLS denial tests, OTP/session and inventory concurrency invariants. |
| M3 core journey | Search → quote → hold → verified pay → confirmation; cancellation, late capture and unknown payment recovery work in browser and database. |
| M4 operations | Check-in/cleaning/ready, extension, closures, support, notifications, reconciliation and relevant admin/report paths. |
| M5 quality | Independent permission/data-safety review, responsive/accessibility rehearsal, load results, restore drill and final diff check. |
| M6 controlled pilot | Approved policy decisions, provider sign-off, truthful 5–10-partner content, staff rehearsal, monitoring/support/rollback, Android/iOS distribution readiness and recorded owner go-live decision. |

Every milestone runs the app and its acceptance checks, records unresolved issues and updates handoff. Critical inventory, payment, unauthorized access or data-loss defects block pilot. Defer lower-severity issues only with named owner, impact and follow-up; passing build alone is insufficient.

## 4. Release, recovery and pilot learning

Promote reviewed commit and additive migrations through staging. Verify production secrets/account ownership, environment separation, callback URLs, sender, timezone, policy snapshots and provider mode without displaying secrets. Take a verified recoverable backup; migrate, deploy compatible application/worker, then smoke-test public browsing, login, non-financial staff access and alert delivery. Enable booking behind a switch only after operational approval.

If a critical fault appears, disable new holds/extensions while preserving existing booking visibility and payment/refund ingestion/reconciliation. Alert operations and provide customer support. Roll back application code only to a schema-compatible version; forward-repair financial state from ledger/provider evidence. Never delete transactions or reset the production database to undo a deployment. A restore requires reconciling external payment events after the restored point before sales resume.

Monitor overlapping-claim count (must be zero), failed/unknown payments, captured-unallocated money, pending refunds, queue age, check-in/cleaning failures, venue cancellations and reconciliation differences. Confirm staffed alert recipients. Review TRD's proposed RPO 24h/RTO 4h against achieved drill evidence. During the limited pilot, review conversion, paid occupancy, repeat use, unit economics and venue reliability weekly; expansion needs owner review of actual evidence.
