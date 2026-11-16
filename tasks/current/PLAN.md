# M6 plan: release preparation (local)

Written 3 November 2026. M5 records: `tasks/archive/m5`.

1. M6.A switches: migration `20261103000900_m6_release_switches.sql` with `release_switches` (BOOKINGS, EXTENSIONS,
   PAYOUTS; inserted closed, so a production database starts with sales off; the local seed opens them). Guard
   triggers block new quotes, holds and booking payment orders (BOOKINGS), extension requests, extension holds and
   extension payment orders (EXTENSIONS), payout approval and PROCESSING (PAYOUTS). Nothing else is gated: payment
   verification, webhooks, cancellations, refunds, check-in, reconciliation and marking a batch PAID continue.
   `app.service_status()` public; `app.admin_set_release_switch` superadmin (finance for PAYOUTS), aal2, reason,
   audit. API: `GET /api/v1/service-status`, `GET/POST /api/v1/admin/release-switches`. Web: admin page, paused
   notices on venue/checkout/extension. Mobile: paused notices, actions disabled. Tests: integration (gated and
   ungated paths, permissions, audit), e2e (admin toggles, customer sees paused page).
2. M6.B native minimum version: server setting `NATIVE_MIN_VERSION` returned by service status; mobile sends its
   version, shows an update notice and stops new booking/extension actions below the minimum while bookings, receipts,
   cancellations and support stay usable; booking-creating API routes refuse a below-minimum native client.
3. M6.C release package in `tasks/current/release/`: RELEASE-PACKAGE (gate table with status/owner), RUNBOOK,
   STORE-DISCLOSURES, VENUE-REHEARSAL, secrets inventory and migrations.
4. M6.D Android release variant on the emulator if the build fits; otherwise NOT RUN with reason.
5. Full checks, HANDOFF, REVIEW.
