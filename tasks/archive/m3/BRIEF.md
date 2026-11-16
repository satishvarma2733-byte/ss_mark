# Current task brief - M3 Core journey

Objective: implement M3 from `docs/06-IMPLEMENTATION-PLAN.md` (prompt in `prompts/01-MILESTONE-PROMPTS.md`) in vertical
slices across customer web, Android (and iOS where access allows), plus staff web arrival: manual/location search with
list/map, venue rules, quote, atomic hold, payment adapter, committed confirmation and check-in. Label mock/sandbox mode.
Test simultaneous checkout, expiry, duplicate events, wrong amounts, late capture, pending/offline recovery and native
provider-return/process-death recovery. No client confirms payment. Record per-platform evidence.

State at start (26 Oct 2026, evening): M2 complete and re-verified (records in `tasks/archive/m2/`). Independent review of
M2 performed at the start of this task by a fresh session: no critical/high findings; R1-R4 fixed in M3
(`tasks/archive/m2/REVIEW.md`). iOS NOT RUN (no access). No payment-provider account exists (decision D04 open).

Inputs: docs/07 s.2-3, 5, 7, 8 (API, transitions, payment truth, races); docs/05 money tables; docs/02 s.4-6; docs/03 C01-C09,
P06; docs/04 components; docs/08 T01, T03-T08, T13 (arrival part), T19, T23; M3 gate.

Out of scope (M4): customer cancellation of confirmed bookings and its refund preview, extensions, no-show, partner
onboarding/inventory editing, finance/admin refunds, payouts, reconciliation reports, reviews/support. Real payment
provider, real maps provider, hosted environments, store builds, real money or real customer data.

Provider stance: no sandbox credentials exist, so the payment adapter is exercised against a local **mock gateway**
that behaves like a hosted checkout (orders, signed callback, signed webhooks, duplicate/delayed/out-of-order delivery,
refunds). Every surface labels it. Real-provider sandbox verification stays NOT RUN and the real payment gate is not
passed (docs/06 M3 gate).

Done when: discovery -> quote -> hold -> mock pay -> verified confirmation -> staff check-in works on web and Android
(iOS NOT RUN with owner/path); payment failure, unknown/pending, expiry, late capture, duplicate events, wrong amounts and
concurrent checkout are proven on real PostgreSQL; native provider return and process-death recovery shown on the
emulator; HANDOFF records exact results.
