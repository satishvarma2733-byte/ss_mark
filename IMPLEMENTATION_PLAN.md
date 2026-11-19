# SimplySit — Implementation Plan

**Updated:** 16 November 2026. Approach: incremental milestones inside `build-kit`, the web app stays runnable, API contracts, RLS, payment invariants and synthetic-data labelling are preserved. Gap numbers refer to `PROJECT_AUDIT.md` section 4.

## Status of the earlier milestones

| # | Milestone | Status |
| --- | --- | --- |
| 1 | Design tokens and light/dark theme | **Done** (14 Nov): tokens, contrast tests, theme toggle. Dark mode not yet visually verified (gap 3) |
| 2 | Component library `apps/web/components/ui/` | **Partly done:** 26 primitives built; 6 missing; adoption on 5 of ~47 pages (gaps 1, 2) |
| 3 | Customer application and system states | **Layouts done** (9 and 12 Nov); recovery states and preferences pending (gaps 5, 6) |
| 4 | Partner and staff application | **Desktop done**; arrival progression, support centre, notification centre pending (gaps 7, 8) |
| 5 | Admin application | **Mostly done**; audit, customers, users added 14 Nov; three partial screens remain (gap 9) |
| 6 | Repo hygiene and QA | **Done** for typecheck, lint, unit; integration and e2e need the local database running |

## Remaining work, in order

### A. Safety net first — DONE 16 Nov (baseline commit `977d332`; integration 175/175; e2e green after a 320 px fix)
- Create a git repository in `build-kit` and make a first commit, so every later step can be reviewed and reverted (gap 16). **Needs the owner's go-ahead.**
- Start local Supabase, re-run integration and e2e for a fresh baseline.
- Environment template: already present at `config/.env.example` (no action needed).

### B. Dark mode made real — DONE 16 Nov (30 routes contrast-clean in dark; dark test added to the accessibility spec; e2e 49/49)
- Replace the 61 hard-coded colours in `globals.css` with tokens.
- Screenshot every route in light and dark at 390 and 1440; fix contrast failures; add dark mode to the accessibility scan.

### C. Finish the kit and adopt it — MOSTLY DONE 16 Nov (see HANDOFF; form fields, notices and dynamic status pills still class-based)
- Build `Tabs`, `FilterChip`, `Card`, `DatePicker`, `TimeSelector`, `QrBookingCard`.
- Migrate pages group by group (customer, partner, admin), keeping e2e selectors, and delete the class rules each group no longer needs so there is one system, not two.

### D. Missing screens and states — DONE 16 Nov for web (see HANDOFF for what each screen deliberately leaves out)
- Customer: recovery states on checkout, payment return, booking and extension pages; notification preferences; privacy and preferences.
- Partner: arrival progression steps, support centre, portal notification centre.
- Admin: notification centre, partner-and-venue management, system settings, secure admin access.
- Each screen only where the API already stores the data; anything needing a new table gets a migration and integration test first.

### E. Responsive and accessibility sweep — DONE 19 Nov (responsive: 38 routes x 6 widths, 0 overflow; keyboard: 38 routes x 2 widths, focus visible on every stop, no traps; skip link now moves focus; lasting keyboard e2e test added)
- All routes at 360, 430, 768, 1024, 1280, 1440, 1920: no horizontal overflow, no clipped logos, tables scroll inside their region.
- Keyboard pass and axe scan on every route, both themes.

### F. Native app — IN PROGRESS (19 Nov: venue detail, gallery, book/review, checkout, payment status, booking pass and my bookings done and checked on the Android emulator; extension is next)
- Finish the Figma pass on the remaining Expo screens, add gallery, advanced filters and calendar, verify on a device.

### G. Production preparation — blocked on the owner
| Item | Needs |
| --- | --- |
| Real payment gateway adapter, sandbox checkout, signed webhooks, refunds | Decision D04 and provider sandbox credentials |
| SMS / email delivery | Provider choice and credentials |
| Approved prices, fees, cancellation and extension rules | Decisions D02, D03 |
| Hosted Supabase project, hosting, backups and restore drill, alert delivery, error reporting | Organisation accounts, decision D09 |
| Store listings, app identifiers, iOS build | Apple and Google accounts |
| Independent review of payment, permission and concurrency code (M5.1) | A fresh reviewer |

Engineering can prepare adapters behind the existing provider interface, but none of section G can be called done or tested without those inputs.

## After each milestone
Run typecheck, lint, unit, build, integration and e2e; compare changed screens with their Figma frames; update `DESIGN_SYSTEM_MAPPING.md` statuses and `tasks/current/HANDOFF.md` with the exact commands and results.
