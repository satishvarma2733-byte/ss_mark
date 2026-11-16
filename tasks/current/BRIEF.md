# Current task brief - M6 Release preparation (local part)

Objective: docs/06 M6 and docs/08 s.3-4, within current authorization. Build what the release and rollback procedure
needs in code, assemble a reviewable release package, and record every gate as done, pending or NOT RUN with owner.
No accounts, purchases, real funds, store submissions, deployments or external messages (CLAUDE.md).

| Slice | What | Can be done here |
| --- | --- | --- |
| M6.A Release switches | Server switches for new bookings, extensions and payout release, enforced in the database; production starts closed ("enable booking behind a switch only after operational approval"); existing bookings, arrivals, payment/refund ingestion and reconciliation keep working; admin change with reason, MFA and audit; customers see a clear paused state on web and Android | Yes |
| M6.B Native compatibility | Minimum supported native version: the first store build must carry the check, or a dangerous old client can never be stopped later (TRD "force-update only through an approved recovery plan"; "a forced update must preserve receipt/support access") | Yes |
| M6.C Release package | Secrets inventory without values, migrations, build IDs, runbook (switches, incident, rollback, restore, daily reconciliation), alerts, store privacy/data-safety draft from actual SDKs, venue rehearsal checklist, gate table | Yes (documents); approvals are the owner's |
| M6.D Release build | Android release variant (no dev client, bundled JS) on the emulator: cold start, deep link, payment return | Yes, emulator; signing with an owner key, real devices, iOS NOT RUN |
| M6.1-M6.5 rest | Venue training, staging, store tracks, production accounts, launch, pilot | Owner authorization and accounts |

Still blocking a release candidate from M5: independent review (M5.1), real devices/iOS, hosted restore, provider
sandbox (D04).
