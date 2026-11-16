# Review checkpoint - M6 release preparation (local)

Self-review by the authoring session (not independent). The independent review (M5.1) is still required before a
release candidate; a fresh-session review has been proposed with this scope plus the M6 files below.

| Area | Checked | Evidence |
| --- | --- | --- |
| Switch enforcement | Guard triggers on every row that starts a commitment: quotes, bookings (holds), payment orders (booking vs extension by `extension_id`), extension requests (insert and move to HELD), payout batches (APPROVED/PROCESSING). Rows found by searching every `insert into` / status update in the migrations; no other path creates bookings, quotes or orders | `tests/integration/release-switches.test.ts`; removing two triggers made 2 of 6 tests fail (mutation check) |
| Not blocked while closed | Verifying a payment already started (webhook), applying an extension already being paid, cancellation with refund, extension cancel, payout CANCELLED, search and booking lists | Same tests, e2e `release.spec.ts` |
| Default state | Migration inserts all switches closed; a missing switch reads as closed; only `supabase/seed.sql` (local) opens them | Integration "defaults" test; `SECRETS-AND-CONFIG.md` |
| Permissions | View: support/finance/superadmin with TOTP; change: superadmin (BOOKINGS, EXTENSIONS), finance or superadmin (PAYOUTS); reason 10-500, optimistic version, audit row with actor, role, reason and diff; anonymous gets only the two open/closed booleans | Integration "changing a switch" tests; e2e support cannot change |
| Native compatibility | Version header on every native call; booking-creating routes (quote, hold, checkout, extension request/hold/checkout) refuse versions below `NATIVE_MIN_VERSION` with 426; reads, cancellation and support never checked; web sends no header. This is compatibility, not security: the database switches remain the control | Unit (version compare, client header, sales state); e2e old client refused, list still works |
| Customer experience | Web venue and book pages say bookings are paused and show no times; app venue screen hides times, extension screen explains; API errors carry the same text | Screenshots `evidence/m6/web-m6-*`; accessibility scan includes `/admin/release` (0 violations) |
| Operations checks | 14 read-only checks with thresholds from docs/08 monitoring list; run locally: correctly alerted with no worker running | `scripts/ops-checks.sql`, `pnpm ops:check` |

Open: Q1 independent review; Q2 production identifiers, store accounts, provider (D04) and policies (D02/D03); Q3 no
error/crash reporting SDK integrated; Q4 search results still show availability while BOOKINGS is closed (venue and
book pages explain the pause and nothing can be held); Q5 release APK permissions (M6.D).
