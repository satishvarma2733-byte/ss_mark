# Current handoff - M4.1 Cancellation and refund of confirmed bookings

Date: 2 November 2026. Root: `C:\Users\abhin\Desktop\Simply_Sit\build-kit`. Brief/plan: `tasks/current/BRIEF.md`,
`PLAN.md`. Review: `tasks/current/REVIEW.md` (author self-review; independent review NOT yet performed for M4.1).
M1-M3 records: `tasks/archive/m1`, `m2`, `m3`.

## Status

M4.1 is implemented and checked locally against the **mock payment provider** (no provider account, D04):

- Customers can see the refund for cancelling now (from the policy they accepted and the payment actually captured, at
  the database clock), cancel once with an optional reason, and see the refund as "in progress" until the provider
  confirms it, then "refunded". Cancelling inside the cutoff gives no refund and frees the table.
- If the refund changed between preview and confirmation (the cutoff passed), nothing is cancelled; the customer sees
  the new amount and confirms again (409 `CANCELLATION_CHANGED` with the new terms).
- Venue managers/owners (TOTP) and platform support/superadmin (TOTP) can service-cancel a confirmed booking until its
  end with a full refund and a required, audited reason (API only; partner UI comes with M4.3, admin UI with M4.4).
- The worker submits the refund with the existing idempotent path and sends the cancellation notice.
- Web (C08 link + C10 page) and Android (booking screen button + cancel screen) done. iOS: **NOT RUN - no access.**
- Policy is the **proposed** one (D03 not owner-approved): full refund at least 120 minutes before the start, none
  after; venue/service cancellation 100%.

## What changed

- `supabase/migrations/20261102000200_cancellation.sql`: refund reasons `CUSTOMER_CANCEL`/`SERVICE_CANCEL`, journal kind
  `CANCELLATION_REFUND_DUE`, job kind `booking.cancelled`; `app.cancellation_terms` (pure, takes `now`; half-up whole
  paise; exactly at the cutoff counts as early), `app.booking_allocated_attempt`, `app.apply_cancellation` (one
  transaction: CANCELLED, codes cleared, claim released, refund liability journal + refund row + `refund.submit`,
  `refund.requested`, booking event, `booking.cancelled`), `app.cancel_preview`, `app.cancel_booking`,
  `app.service_cancel_booking` (audited `booking.service_cancel`), customer projection adds `cancel_reason`
  (stored namespaced: `CUSTOMER:<code|UNSPECIFIED>` or `SERVICE:<code>`; review C1). Grants:
  the three entry points to `authenticated`; internals to nobody; PUBLIC revoked again.
- `packages/contracts`: cancellation schemas, reason lists, `CANCELLATION_CHANGED` (409), shared customer copy
  (`cancellationPolicySummary`, `cancellationNotice`, `refundReasonText`, `refundStatusText`) used by web and native.
- `packages/db`: `cancelPreview`, `cancelBooking`, `serviceCancelBooking`; job kind union. `packages/api-client`:
  `cancelPreview`, `cancelBooking`.
- `apps/web`: `POST /api/v1/bookings/{id}/cancel-preview`, `POST /api/v1/bookings/{id}/cancel` (Idempotency-Key),
  `POST /api/v1/bookings/{id}/service-cancel` (Idempotency-Key); page `/bookings/[id]/cancel` (C10); booking page shows
  a Cancel link while cancellable, who cancelled, refund state and the accepted policy text from the snapshot.
- `apps/worker`: `booking.cancelled` -> in-app + email notice (`booking_cancelled`), idempotent by business key.
- `apps/mobile`: `app/cancel/[bookingId].tsx` (C10), booking screen button, cancellation notice, refund states, reload
  on focus.
- Tests: `tests/integration/cancellation.test.ts` (new), `apps/web/e2e/cancellation.spec.ts` (new), worker unit test;
  shared e2e helpers moved into `apps/web/e2e/helpers.ts`.

## How to run

```
cd C:\Users\abhin\Desktop\Simply_Sit\build-kit
pnpm db:start && pnpm db:reset && pnpm env:local
pnpm dev:web      # book and pay as in M3, then /bookings/<id> -> Cancel booking
pnpm dev:worker   # submits the refund and sends the notice
```

## Checks run and results

Full sequence on 2 November 2026 after the last code change (C1 fix), one log per step:

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm secrets:check` | PASS |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS - 11 workspace projects |
| `pnpm test:unit` | PASS - 11 files, 65 tests (new: worker `booking.cancelled`, shared cancellation copy incl. the C1 regression, cancel request schema) |
| `pnpm db:reset` | PASS - 17 migrations + seed from empty |
| `pnpm test:integration` | PASS - 12 files, 127 tests (new `cancellation.test.ts`: 14) |
| `pnpm build` | PASS - routes `/api/v1/bookings/[id]/{cancel,cancel-preview,service-cancel}` and `/bookings/[id]/cancel` built |
| `pnpm test:e2e` | **29/29** on the last run (2.4 min). See the stall note below for the earlier runs |
| `pnpm test:mobile` | PASS - Android and iOS Hermes bundle export |
| `expo install --check` | PASS - dependencies up to date |

**E2E stall note (environment, to watch).** Four of five full e2e runs today failed one or two tests, every time on a
stall rather than a wrong answer: Auth's `POST /otp` hit its 10 s deadline twice ("context deadline exceeded"), a
checkout POST took ~35 s (trace + database: the payment order row was written 9 ms into the request, the mock
provider order 35 s later), and a cancel POST answered after 21.9 s although the cancellation was written 16 ms in.
The same pattern was recorded in M3. Investigation:
- Postgres' own checkpoint log shows the Docker VM's storage stalling at those times: single-file fsyncs of **31.4 s**
  (13:00-13:03 UTC) and **10.0 s** (13:10-13:11 UTC), while the check sequence was running integration, build, e2e
  and the mobile export on the same disk. Commits must flush WAL, so a stalled flush freezes any write request.
- On a quiet machine, probes found nothing: 443,642 pooled and 10,255 fresh-connection round trips (2 min), 228
  queries after 1-15 s idle gaps (3 min), 3,972 durable commits with a maximum of 18 ms (4 min, across a
  checkpoint); then e2e passed 29/29 and the checkpoint fsync took 0.025 s.
- Not proven for each individual stall (WAL flush time is not captured by `pg_stat_statements`, and slow-statement
  logging did not reach the container log). Not caused by M4.1 code: it also hit M3 checkout and Auth itself.
- A product point for M5 (T21 reliability): the web routes and UI have no request timeout, so a stalled database
  leaves the customer on "Cancelling..."/"Opening payment..." for up to ~35 s. Retrying is safe (idempotent); a client
  timeout with "still working, check your booking" copy is worth adding.

What the new integration tests prove (docs/08 T09/T10): exact cutoff (early at -2:00:00, late 1 microsecond later, late
at the start); half-up rounding; preview = cancel amount; early full refund liability -> one provider refund ->
PROCESSED with balanced journals; late cancel with no refund and no journal; table re-bookable at once; changed terms
-> 409 with the new terms and nothing changed; stale version; repeat and 5 concurrent cancels -> one cancellation,
one refund, one event; other customers and staff NOT_FOUND; checked-in and started bookings refused; duplicate capture
+ cancel -> refunds on two attempts, a further refund rejected by the ceiling; cancel vs check-in race (3 rounds)
-> exactly one wins; service cancel (manager aal2 yes, aal1 REAUTH, bad code VALIDATION, staff FORBIDDEN, outsider
NOT_FOUND, support yes, audited, 100% inside the late window); cancellation notices queued once per channel.

Web e2e (new `cancellation.spec.ts`): book -> pay -> booking page -> Cancel -> C10 shows policy and Rs 300 refund ->
reason -> confirm -> Cancelled, "You cancelled", refund in progress, QR gone, cancel page redirects back; late booking:
stale full-refund request -> 409 `CANCELLATION_CHANGED`, page shows Rs 0, replay with the same Idempotency-Key returns
the identical result, a new key -> 409; other customer's preview 404; manager aal1 403 REAUTH, staff aal2 403, manager
aal2 200 -> customer sees "cancelled for you because the table is unavailable" and a full refund in progress.

## Native evidence (Android)

2 November 2026, emulator `simplysit_api36` (Android 36, x86_64), existing debug dev client (no native module change),
Metro `CI=1 npx expo start --dev-client`, web API `next start` on 3000 and worker via `adb reverse`. Fictional fixture
venue `native-quick-cafe` and `native.m3.customer@example.test`; confirmed bookings made with the real quote -> hold ->
checkout -> mock capture -> server apply path (scratch script, local database only). Screenshots in
`tasks/current/evidence/m4/`:

| Step | Result |
| --- | --- |
| Booking 3 h ahead: Cancel button under the accepted policy text (`android-01`) | PASS |
| Cancel screen: paid Rs 360, refund Rs 360, "applies if you cancel before 19:20 IST", reasons (`android-02`) | PASS |
| Confirm -> back on the booking: Cancelled, "You cancelled", refund "in progress, not yet confirmed" (`android-03`) | PASS |
| Worker submitted the refund (PROCESSED with provider refund ID; cancellation email sent); app shows "refunded by the payment provider" (`android-04`) | PASS |
| Booking inside the cutoff: refund Rs 0, "not refunded Rs 360", deadline warning (`android-05`); cancel -> Cancelled, no refund line (`android-06`) | PASS |
| Cancel screen opened before the cutoff with Rs 360 shown; confirmed after the cutoff passed -> server refused, screen shows Rs 0 and "The refund has changed ... confirm again" (`android-07`, `android-08`); booking still CONFIRMED until reconfirmed, then Cancelled with no refund | PASS |

Defect found on the device and fixed: after confirming, the cancel screen used `router.back()`; when it had been opened
from a link on top of another booking, the customer landed on that other booking. Now `router.dismissTo` the cancelled
booking (pops to it, or replaces the screen); rechecked on the emulator (`android-06` shows the right booking).

## Not verified

- iOS: NOT RUN - no access. Real provider refund (sandbox, partial refund support, refund webhooks): NOT RUN (D04).
- Partner/admin UI for service cancellation: not built (M4.3 / M4.4); API covered by integration and e2e tests.
- Physical Android device: NOT RUN.
- Independent review of the M4.1 money/permission/concurrency changes: NOT performed (REVIEW.md).

## Unresolved issues and owners

- D03 cancellation policy (cutoff, percentages) - product owner; shown as proposed.
- Retained amounts from late cancellations stay as booking liability until M4.4 recognizes venue/platform revenue.
- A refund that FAILS after cancellation stays owed, audited and counted in queue metrics; the operator path is M4.4.
- Carried from M3: provider account (D04), maps provider, iOS access, F7 commission visibility, R6.

## Machine state left behind

- Running: this project's local Supabase stack (stop with `pnpm exec supabase stop` from build-kit). Djain untouched;
  its `supabase_vector_Djain` container is in a restart loop (289 restarts; not ours to change).
- Stopped: emulator, web server, worker and the two Metro instances started this session (their `node` children
  stopped by PID, all created this session).
- Diagnostics: `log_lock_waits` and `log_min_duration_statement` were set with `ALTER SYSTEM` (as `supabase_admin`)
  during the stall investigation and **reset** afterwards (`show` confirms off / -1).
- Local database: reset by the check run (the native fixtures are gone; scratch scripts recreate them), then test
  data from the integration and e2e runs.
- The Android screenshots were taken before the C1 fix; the customer-visible text they show is unchanged by it.

## Rollback

Delete `20261102000200_cancellation.sql` and run `pnpm db:reset` (returns to the M3 schema); remove the three routes,
the cancel page/screen and the contracts additions. Existing M3 behaviour is unchanged apart from the booking page copy.

## Next concrete task

1. Independent review of M4.1 money/permission/concurrency changes (fresh session, read-only), or batch it with M4.2.
2. M4.3 partner operations (onboarding, profile/rules/photos, hours, tables, blackouts, calendar, staff invites,
   pause/resolve/retry closure; partner UI for service cancellation), then M4.2, M4.5, M4.4, M4.6.
3. Owner: D03 policy approval; D04 provider account; iOS access; maps provider.
