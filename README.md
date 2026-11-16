# Simply Sit build kit

Prepared 25 October 2026. This folder is the starting project folder for Claude Code. Planning is complete; application implementation and runtime verification have not started.

The owner confirmed a partner marketplace, the newer broad hospitality proposal as the primary brief, and a simultaneous website plus Android and iPhone customer release. The current brand promise is **Your Space. Your Time.** Venue food rules must be disclosed; bringing outside food is not promised across all venue categories.

## Start here

1. Read `docs/00-SOURCE-REVIEW-AND-DECISIONS.md` and `docs/09-PILOT-RESEARCH-AND-COMMERCIAL-ASSUMPTIONS.md` for the review, researched recommendations, and remaining owner decisions.
2. Review the six specifications in `docs/01` through `docs/06`. Editable Word copies are in `documents/`; Markdown is the working source of truth for the coding agent.
3. Open **this build-kit folder** in Claude Code so `CLAUDE.md` is at the project root. Do not scatter these files into a different working directory or overwrite an existing project's instructions without reviewing them.
4. Paste the kickoff prompt from `prompts/00-START-HERE.md`. It starts with repository inspection and Milestone 1, using test providers and synthetic data.
5. Use one milestone prompt at a time from `prompts/01-MILESTONE-PROMPTS.md`. Keep task evidence in `tasks/current/`. Before moving on, run the app, check the milestone criteria, and record failures or unverified items.

## Contents

| Path | Purpose |
| --- | --- |
| `CLAUDE.md` | Concise Claude Code project instructions |
| `AGENTS.md` | Shared expectations for other coding agents |
| `docs/agent-context.md` | Proposed architecture, future folder map, commands, invariants |
| `docs/00-SOURCE-REVIEW-AND-DECISIONS.md` | Source review, precedence, gaps and decision register |
| `docs/01-PRD.md` | Product scope, features, stories, success measures and acceptance criteria |
| `docs/02-TRD.md` | Platforms, technical choices, integrations, security and reliability |
| `docs/03-APP-FLOW.md` | Screens, journeys, action states, navigation and recovery |
| `docs/04-UI-UX-DESIGN-BRIEF.md` | Brand, components, accessibility and responsive/native design |
| `docs/05-BACKEND-SCHEMA.md` | Data dictionary, relations, permissions, constraints and retention |
| `docs/06-IMPLEMENTATION-PLAN.md` | Ordered tasks with owners, inputs, outputs, dependencies and completion gates |
| `docs/07-API-AND-STATE-MACHINES.md` | API contract and inventory, booking and payment transitions |
| `docs/08-TEST-AND-RELEASE-PLAN.md` | Test matrix, release checklist, monitoring and rollback |
| `docs/09-PILOT-RESEARCH-AND-COMMERCIAL-ASSUMPTIONS.md` | Pilot location, cost model, timeline and unit economics |
| `prompts/` | Kickoff, six milestone prompts, independent review and recovery prompts |
| `tasks/current/` | Initial BRIEF, PLAN, HANDOFF and REVIEW checkpoints |
| `config/.env.example` | Variable names and ownership only, no real credentials |
| `references/` | Source manifest and brand reference images |

## Recommended starting position

Research supports testing Bengaluru; start venue recruitment in a compact Koramangala cluster, then choose one service polygon from field evidence. This is a recommendation, not an established customer market. Recruit 5-10 partner venues across suitable hospitality categories. Start with individually identified tables to reduce physical inventory risk. Seats, zones, and whole spaces remain part of the broader product vision and need a reviewed overlap model before sale.

Plan approximately 22 weeks from a staffed start for web plus native clients, including beta and review buffers. A sample 2 November 2026 start produces a March 2027 private beta and an April 2027 controlled paid pilot. The planning cost envelope is INR 27-42 lakh including contingency and limited pilot preparation, excluding GST and broad advertising; the cost model is an estimate, not a supplier quote.

These recommendations permit local development with simulated services. Live collection, partner settlement, signed commercial terms, production deployment and store submission depend on actual accounts, approved policies, and the release gates. No deployment or account purchase has been performed.
