# M4 code review - findings and resolutions

Date: 3 November 2026. Scope: the six M4 migrations (cancellation, partner operations, extensions, support/reviews,
finance, notifications/metrics), focused on money, permissions/TOTP and lock order/races.
Method: the `code-review` skill (high effort) run as a separate review pass with read-only access. It is NOT a human
review and the reviewer shared this session's context, so it does not replace the independent review the project
rules require before release.

Fixes: `supabase/migrations/20261103000600_m4_review_fixes.sql` (built from the current function text with exact,
asserted replacements; the builder is `build_fixes.py` in this folder, for reference only - the migration is the source of truth).

| # | Finding | Verdict | Resolution | Test |
| --- | --- | --- | --- | --- |
| 1 | Cancellation, service-cancel and no-show refunds used the full capture, ignoring an earlier admin refund taken from the booking: cancellation could fail (ceiling) or over-refund | Real | Refund capped by what the capture still holds for the booking (`booking_liability_balance`); retained = remaining - refund | finance "caps a later cancellation refund"; cancellation rounding test |
| 2 | A FAILED refund could be re-issued as a new admin refund: liability posted twice, partner/platform charged twice, payout netted twice | Real | `refunds.retry_of`; `admin_retry_refund` (finance + TOTP + reason) retries the same liability with no journal and no charge; a FAILED refund stays reserved until retried; API `POST /admin/refunds/{id}/retry`, retry control on the admin booking page | finance "retries a failed refund once"; e2e finance |
| 3 | Payout batches spanning more than 31 days could never be approved (one run had to cover everything) | Real | Approval checks every capture (and processed refund) behind the batch against MATCHED runs, several runs allowed; a newer MISMATCH over the same instant still blocks | finance "payout reconciliation coverage" |
| 4 | Payout approval (and the metrics reconciliation state) ignored provider/environment: a TEST run could approve LIVE money | Real | Coverage requires a run of the capture's own provider and environment; metrics use the environment of the period's captures | same test (a LIVE run does not count) |
| 5 | A venue's bundled policy draft stayed editable while the venue was in review; approval could publish terms the reviewer never saw | Real | Trigger freezes draft terms (content fields) while the venue is PENDING_REVIEW | partner "sends a venue back..." |
| 6 | `admin_refund` not idempotent at the database | Partly (the API's Idempotency-Key already prevents duplicates) | A replayed request id returns the existing refund | finance "...replayed request returns the same refund" |
| 7 | Admin refunds recorded the requester as approver | Partly (single-person refunds are the current design) | `approved_by` left empty for admin refunds; a second approver above a threshold is an owner decision (open) | same test |
| 8 | Any manager could revoke an owner's MANAGER invitation | Real | Owner-only, as for inviting or removing managers | partner invitations test |
| 9 | Marking an invitation EXPIRED on accept was rolled back by the error; stale invitations blocked slots and the 50-invite limit | Real | Dead write removed; every new invitation at the venue first expires the venue's stale ones | partner invitations test |
| 10 | `customer_booking_json` repeated in three migrations | Not a defect | Migrations redefine the function; only the latest definition runs. No change | - |

Checks after the fixes (3 Nov 2026, ~11:00 IST): db:reset (23 migrations), typecheck, lint, unit 70, integration
**168/168** (17 files), build, test:mobile, secrets - PASS. E2E: first full run 39/40 (partner closure test, an element
not found after an action); that test then passed 3 times alone and the next full run was **40/40**. Recorded as an
intermittent test to watch.

Still open: the independent (human or fresh-context) review before release; owner decision on a second approver for
large admin refunds; the customer receipt lists a failed refund and its retry as two lines.
