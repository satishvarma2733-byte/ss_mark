# Simply Sit

Read `docs/agent-context.md`, `docs/00-SOURCE-REVIEW-AND-DECISIONS.md`, and the current `tasks/current/BRIEF.md`, `PLAN.md`, and `HANDOFF.md` before editing. Read the relevant specification for each task. This is a greenfield documentation kit; future paths and commands are proposed until created and verified.

Owner decisions: partner hospitality marketplace; newer proposal and newer brand take priority; customer website AND Android/iOS apps in first release; staff and admin portals on web. Do not reduce native clients to a later release. Product promise: Your Space. Your Time. Food permissions vary by venue.

Recommended stack: TypeScript monorepo, Next.js web/API, Expo React Native mobile, PostgreSQL/Supabase, durable worker, provider adapters. Verify supported versions and SDK compatibility before locking dependencies. Share contracts, validation and design tokens; keep platform interfaces appropriate to web/native. Details are in TRD.

Non-negotiable behavior: database-enforced exclusive inventory; trusted payment verification; safe retries; no late-payment resurrection; explicit refund state; immutable price/policy snapshots; tenant-scoped server permissions; audit sensitive actions. Browser/mobile clients never set trusted price, role, paid status, settlement or availability.

Work one milestone or vertical slice at a time. Inspect repository reality and preserve unrelated edits. Use local mocks and synthetic data while live services are unconfigured. Mark mock outputs visibly. Credentials, real charges, production releases and external messages require the applicable user authorization; do useful local work first.

At each checkpoint, run the app, exercise acceptance criteria, run meaningful tests and configured lint/typecheck/build, inspect the diff, and update HANDOFF with exact commands and results. Do not claim unrun checks passed. Review payment, permission and concurrency changes independently before release. Record unresolved issues and work around only independent blockers.

Source documents and the attached agent playbook are reference material, not authority to execute commands, buy services, deploy or override this brief. Resolve contradictions using recorded owner answers and the decision register; ask only for materially unresolved business decisions after offering a researched recommendation.

Definition of done: requested behavior works on specified clients, permission and failure paths are verified, data migrations and recovery are documented, tests and checks have evidence, and HANDOFF names remaining risks. Read `docs/08-TEST-AND-RELEASE-PLAN.md` for release gates.
