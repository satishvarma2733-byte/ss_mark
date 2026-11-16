# Current task brief - M2 Data and auth

Objective: implement M2 from `docs/06-IMPLEMENTATION-PLAN.md` (prompt in `prompts/01-MILESTONE-PROMPTS.md`): reviewed
migrations, constraints, indexes, RLS and synthetic seeds; web/native authentication and server roles; atomic exclusive
inventory and durable jobs. Test real PostgreSQL conflicts, cross-venue access denial, policy snapshots and session
recovery. Never bundle server keys. Run the app and checks, update evidence, and stop at M2.

State at start: M1 complete on Windows (records in `tasks/archive/m1/`); iOS NOT RUN (no access).

Inputs: docs/05 (schema, RLS matrix), docs/07 (API, state machines, races), docs/02 s.4-6, docs/03 C02/C14, docs/08 M2 gate.

Out of scope: payments, refunds, ledger, extensions, check-in, partner onboarding (M3/M4); hosted environments; real
accounts, emails or charges. All data synthetic; email goes to the local Mailpit inbox only.

Done when: migrations apply from empty; RLS/role denial, timezone, snapshot and concurrency tests pass on real PostgreSQL;
web and native sign-in and permission-denied paths run; worker crash recovery demonstrated; HANDOFF records exact results.
