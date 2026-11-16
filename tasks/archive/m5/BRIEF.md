# Current task brief - M5 Quality

Objective: docs/06 M5 and docs/08 T20-T23 against the actual code. Gate: release candidate with recorded build IDs and
results; no critical/high unresolved defect; anything not run is marked NOT RUN with impact and owner. Automated tests
do not replace provider, device or restore evidence.

| Slice | What | Can be done here |
| --- | --- | --- |
| M5.2 UX and accessibility (T20) | Automated WCAG scan of key web pages, keyboard-only critical flows, 320/375/768/1440 px and 200% zoom, contrast; Android font scale 2.0 and screen-reader labels; touch targets; payment recovery | Yes (web + Android emulator) |
| M5.3 Reliability and load (T21) | Measured p95 at 50 sessions / 10 checkouts on a production build; concurrent hold/closure/extension; delayed and duplicate webhooks; worker restart; duplicate jobs; rate limits | Yes, locally (not staging) |
| M5.5 Data recovery (T22) | Backup and restore into an isolated database, link and ledger checks, measured restore time; retention/redaction jobs; migration forward test and application rollback compatibility | Yes, locally |
| M5.4 Device and upgrade (T23) | Real Android and iPhone; background/foreground, permission denial, intermittent network, logout/deletion, old-client API compatibility | Emulator only; real devices and iOS NOT RUN (owner) |
| M5.1 Independent review | Reviewer independent of the authoring session | Needs a fresh reviewer (user-triggered `/code-review ultra` or a new session); this session prepares the scope |

Out of scope: staging infrastructure, real provider sandbox (D04), store builds (M6).
