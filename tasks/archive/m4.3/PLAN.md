# M4.3 plan: partner operations

Written 2 November 2026 before M4.3 edits. M4.1 records: `tasks/archive/m4.1/`.

## Database (`supabase/migrations/20261103000100_partner_operations.sql`)

- Columns: `venues.status_reason`, `venues.submitted_at`; `resources.pause_reason`; `venue_policies.submitted_at`
  (a draft submitted for review on a live venue); `venue_media.status` adds `REMOVED`.
- `venue_invitations` (venue, email, email_hash, role STAFF/MANAGER, status INVITED/ACCEPTED/REVOKED/EXPIRED,
  expires_at, invited_by, accepted_by); one open invitation per venue+email.
- Partner functions (manager/owner, aal2, venue lock where inventory is involved, audit):
  `partner_apply`, `partner_update_venue`, `partner_save_policy_draft`, `partner_submit_policy`,
  `partner_create_resource` (with its first rate), `partner_update_resource` (capacity not below future party sizes),
  `partner_set_rate` (future-dated new version, closes the open one), `partner_pause_resource` / `resume` / `retire`,
  `partner_set_hours` (new schedule version; 409 with references if a future hold/booking would fall outside),
  `partner_set_amenities_tags`, `partner_add_media` / `partner_remove_media`, `partner_submit_venue` (completeness
  check), `partner_release_closure`, `partner_invite`, `my_invitations`, `accept_invitation`, `partner_revoke_member`,
  `partner_venue_overview` (P03/P04 data), `partner_staff` (P08), `partner_calendar` (bookings + closures + readiness),
  `partner_booking_detail` (P06 minimal), `staff_mark_no_show` (after grace, same locks as check-in).
- Admin functions (SUPPORT/SUPERADMIN, aal2, reason, audit): `admin_venue_queue`, `admin_venue_detail`,
  `admin_review_venue` (APPROVE / REQUEST_CHANGES / REJECT / PAUSE / RESUME; approve publishes the policy draft and
  pending photos; pause lists affected future bookings), `admin_publish_policy` (live-venue policy change).
- Storage: `venue-media` bucket private; objects `<venue_id>/<uuid>.<ext>`; insert only by the venue's manager/owner
  (aal2); read when APPROVED on a PUBLISHED venue, or by the venue's members and platform support.

## Server and clients

- `packages/contracts`: partner/admin request schemas (allowlisted fields), amenity/tag catalogues reused.
- `packages/db`: wrappers. `apps/web/lib/media.ts`: upload validation (size, MIME by magic bytes), Storage calls with
  the caller's own token; `GET /api/v1/media/{id}` proxy.
- API routes under `/api/v1/partner/...` and `/api/v1/admin/venues/...` per docs/07 s.4 (Idempotency-Key on creates,
  expected_version on updates).
- Pages: `/partner` (P02 venue switcher, today, application status, invitations to accept), `/partner/apply` (P01),
  `/partner/venue` (P03 profile, rules, photos, amenities/tags, submit), `/partner/inventory` (P04 tables, rates, pause,
  hours, closures), `/partner/calendar` (P05), `/partner/bookings/[id]` (P06: details, no-show, service cancel),
  `/partner/staff` (P08), `/admin/venues` + `/admin/venues/[id]` (A02). Venue pages show approved photos.

## Tests

Integration `tests/integration/partner-operations.test.ts`: apply -> configure -> submit (incomplete refused) -> admin
approve -> quotable; request changes; staff/other-venue/customer denied (FORBIDDEN/NOT_FOUND); aal1 refused; rate change
applies to new quotes only; capacity reduction below a booked party refused; hours change conflicting with a booking ->
409 with reference; closure conflict -> pause (new holds refused, existing kept) -> service cancel -> closure succeeds;
closure release; invitation accept with matching email only, wrong email NOT_FOUND, expired refused, revoke, last owner
protected, manager cannot invite MANAGER; no-show before grace refused, after grace once; storage policies.
Web e2e `partner.spec.ts`: apply through the UI, configure, upload a photo, submit; admin approves; venue searchable;
closure conflict UI path. Checks: full sequence.

## Rollback

New migration + additive routes/pages; delete the migration and `pnpm db:reset`. The bucket becomes public again only
by reverting `supabase/config.toml`.
