# Handoff - M4.5 Support and reviews

Dates: 2-3 November 2026. Brief/plan: `BRIEF.md`, `PLAN.md`; review: `REVIEW.md` (self-review only).

## Status

Done on web, API and Android (Android built and bundled; emulator run pending with the other M4 native screens):

- C12 reviews: one per COMPLETED booking by its customer; PENDING until support publishes or hides (reason, audited);
  venue pages (web + Android) show the published summary and recent reviews, no names.
- C13 help: emergency copy (112), FAQ, own support requests with the customer-visible reply. Safety requests are
  confidential and high priority.
- Venue staff report incidents from the booking page (P06); they see only their own reports.
- A04: ticket queue (confidential tickets the caller may not open are counted, not listed), detail with private notes,
  triage (status, priority, assignment, reply), audited contact reveal with a reason. Superadmins assign confidential
  tickets; support can open them only when assigned.
- A03a/A03: booking lookup for support/finance/superadmin with TOTP (reference, date, exact email - audited) and a
  timeline with every payment attempt, refunds, extensions and visible tickets; viewing is audited.

## What changed

- `supabase/migrations/20261103000300_support_reviews.sql` (+ customer projection `review`).
- `packages/db/src/support.ts`, contracts (reviews, tickets, incidents, search, venue `reviews`), api-client.
- Web: routes under `/bookings/{id}/reviews`, `/support-tickets`, `/partner/incidents`, `/admin/{reviews,support-tickets,bookings}`;
  pages `/help`, `/support/[id]`, `/bookings/[id]/review`, `/admin/{support,reviews,bookings}` (+ detail pages), nav Help.
- Android: Help tab, `support/[id]`, `review/[bookingId]`, booking review button, venue rating.
- Tests: `tests/integration/support-reviews.test.ts` (5), `apps/web/e2e/support.spec.ts` (3). Test hygiene: all quick
  test venues now open 04:00-03:55; the e2e TOTP helper waits for the step-up redirect (it could cancel the verify call).

## Checks (3 Nov 2026, 05:5x IST)

install, secrets, lint, typecheck, unit (65), db:reset (20 migrations), integration (15 files, 151 tests), build,
e2e **36/36**, test:mobile, expo check - all PASS. Evidence: `tasks/current/evidence/m4/web-m45-01..04-*.png`.

## Found and fixed

- `app.can_see_ticket` returned NULL for an unassigned confidential ticket, which a `not ...` guard would have let
  through: unassigned support could have opened confidential tickets. Now always true/false; tested.
- `/help` failed for signed-in users (bookings list shape); fixed and covered by e2e.

## Not verified / open

- Android emulator run (pending), iOS NOT RUN. Ticket/review notifications: M4.6. Independent review NOT performed.
