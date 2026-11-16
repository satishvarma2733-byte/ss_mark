# Current task brief - M4.3 Partner operations

Objective: docs/06 M4.3 - "Onboarding review, profile/rules/images, opening hours, exclusive table inventory, blackouts,
calendar and role-limited staff invites; conflicting closure returns 409, manager pauses new sales, resolves affected
bookings explicitly, then retries closure" - on the partner and admin web portals and the API (docs/03 P01-P06, P08,
A02; docs/07 s.4 partner/admin commands; docs/08 T12, T14).

State at start (2 Nov 2026): M4.1 cancellation done (records `tasks/archive/m4.1/`). Existing: partner/admin portal shells,
staff arrival desk, `create_closure` (409 with conflicting references), service cancellation API, venue/resource/policy/
rate/hours tables with immutability guards, private-by-design media table, `venue-media` Storage bucket (configured public).

Rules:
- Every write is a SECURITY DEFINER function with membership re-checked inside the transaction, aal2 for portal writes,
  audit for privileged actions; another venue's records are NOT_FOUND; staff cannot edit venue, rates, staff or payouts.
- Published policies and rates are immutable; new versions apply to new quotes only; existing booking snapshots never
  reprice. Hours/capacity/closure changes take the venue/resource lock path and refuse changes that would invalidate
  active holds or bookings (409 with the affected references) - never silent cancellation.
- Publication only through admin review of a complete venue (profile, policy, at least one priced table, hours, photo).
- Photos: private until approved; JPEG/PNG/WebP only, 5 MB, content sniffed; served through an API route that applies
  the same visibility rules as the database.
- Staff invitations by email; acceptance only by a signed-in user whose verified email matches (no emailed secret).
  Managers invite STAFF; owners invite STAFF or MANAGER; the last owner cannot be removed.

Out of scope: partner reports/statements and payout onboarding (M4.4), extension decisions (M4.2), incident reports
(M4.5), real email delivery (mock provider), maps provider.

Done when: a new partner can apply, configure and submit; an admin approves and the venue becomes bookable; the closure
conflict -> pause -> service-cancel -> retry flow works; staff invitation/acceptance/revocation works; permission and
conflict tests pass on real PostgreSQL; partner/admin UI exercised in the browser; HANDOFF records results.
