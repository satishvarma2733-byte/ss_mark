# Review checkpoint - M5 quality

Independent review (M5.1): **NOT performed**; scope prepared in `M5.1-REVIEW-SCOPE.md` for a fresh reviewer.

| Area | Checked | Evidence |
| --- | --- | --- |
| Web accessibility (T20) | 29 pages scanned twice (58 scans) (public, customer, partner, staff, admin) with axe-core WCAG 2.0-2.2 A/AA rules at 1440 px and 320 px: 0 violations after fixes; no sideways scrolling at 320 px (= 400% zoom, stricter than 200%); visible focus on tab stops; booking and payment completed with keyboard only | `apps/web/e2e/accessibility.spec.ts` |
| Native accessibility | Every tappable element labelled on search, venue, help, account; touch targets 48 dp on Android (44 pt iOS); 200% system text reflows; button names stay correct after busy states | Android emulator, `evidence/m5/android-font200-*` |
| Load (T21) | 50 sessions + 10 checkouts on a production build: p95 search 683 ms, venue detail 426 ms, venue page 926 ms, quote 560 ms, hold 416 ms, checkout 1159 ms, verify 590 ms at the default 30-minute grid; 0 errors; 1 winner of 10 racing for one table; 0 overlapping claims; 0 captured-unallocated | `evidence/m5/load-probe-*.md` |
| Reliability | Worker crash recovery (exactly once), lease/dedupe/webhook/race suites, query plans at pilot scale incl. the per-tick sweeps | `evidence/m5/worker-crash-demo.txt`, `query-plans.txt`, integration suites |
| Recovery (T22) | Logical backup + Storage copy restored into an isolated database: 28/28 checks (counts, constraints, balanced ledger, links, RLS, functions, files); restore + verify 13.5 s at local data size | `evidence/m5/restore-drill.json` |
| Device (T23) | Emulator: location denied, API unreachable and restored, background/foreground with session kept, deletion request, sign-out | `evidence/m5/android-m54-*` |

Fixed in M5: venue page rendered every start time (1,235 links, 748 KB, ~2 pages/s) - now 12 per table from a chosen
time; portal tables widened pages at 320 px and were not keyboard scrollable - focusable scroll regions; earnings
sweep scanned all finished bookings every tick - queue; operational caches never purged - purge job; Android touch
targets 44 -> 48 dp and chips minimum width; Android button names kept "busy" after loading.

Open: Q1 independent review; Q2 real Android/iPhone devices and iOS NOT RUN; Q3 hosted/staging restore and provider
reconciliation since backup NOT RUN (local drill only); Q4 personal-data retention rules (D09); Q5 availability is
computed per candidate start (fine at pilot grids; set-based rewrite if venues use 5-minute grids at scale);
Q6 one intermittent partner e2e (seen once in M4 review); Q7 screen-reader passes with real TalkBack/VoiceOver/NVDA
not run (automated label checks only); Q8 mobile-web LCP and native crash-free rate need a hosted pilot.
