# Simply Sit shared project context

## Product and current state

Simply Sit is a marketplace for time-based access to existing hospitality space. Customers discover, reserve, pay, arrive, extend where available, and request support. Venues control inventory and hours. The latest owner-approved vision includes cafés, restaurants, hotels, breweries, lounges and workspaces. Public tagline: Your Space. Your Time.

Website and Android/iOS customer apps ship in the first release; partner/staff/admin dashboards are responsive web. One physical table per reservation is the proposed initial inventory simplification. Never imply universal BYO food across venue categories. There is no application code or verified package command in this kit yet.

## Proposed folder map to create in Milestone 1

```text
apps/web/                 Next.js customer web, partner/admin portal, versioned API
apps/mobile/              Expo React Native customer app
apps/worker/              Durable background jobs and provider reconciliation
packages/contracts/       Shared request/response schemas and generated types
packages/domain/          Server-only booking, pricing and financial domain services
packages/design-tokens/   Shared palette/spacing/type tokens
packages/api-client/      Typed network client; platform-specific session adapters
supabase/migrations/      Reviewed versioned PostgreSQL migrations and RLS
supabase/seed.sql          Synthetic demo fixtures only
tests/integration/        Real database, RLS, provider events and concurrency
tests/e2e/                Web journeys and API integration
tests/mobile/             Device journeys and native recovery
docs/                     Specifications and operating decisions
tasks/current/            Brief, plan, handoff and review evidence
```

This is a target structure, not a claim that these folders contain code. Keep source and references read-only unless the owner requests changes. Build API modules for discovery, inventory, booking, payments, partner operations, support and reporting. Share safe value validation through contracts; never import server domain services into client bundles. Avoid microservices at pilot scale.

## Proposed command contract

Milestone 1 must create these scripts and replace this list with the exact working commands. Do not run a nonexistent script and describe it as passed.

Milestone 1 status (25 October 2026): every command above exists in the root `package.json`. Exact pass/fail results and the commands that could not run are recorded in `tasks/current/HANDOFF.md`. `pnpm test:mobile` is an Expo bundle export only and is not a device test.

| Command | Required behavior |
| --- | --- |
| `pnpm install --frozen-lockfile` | Repeatable installation after the initial lockfile exists |
| `pnpm dev:web` | Run customer and portal web locally |
| `pnpm dev:mobile` | Start Expo development build workflow |
| `pnpm dev:worker` | Run local queue/worker against local services |
| `pnpm db:start` | Start local Supabase/PostgreSQL dependencies |
| `pnpm db:reset` | Reset LOCAL database and seed synthetic data only |
| `pnpm lint` | Configured lint checks for all workspaces |
| `pnpm typecheck` | Type checks for web, native, worker and packages |
| `pnpm test:unit` | Business and value-object tests |
| `pnpm test:integration` | Database, permissions, concurrency, payment replay tests |
| `pnpm test:e2e` | Web end-to-end critical journeys |
| `pnpm test:mobile` | Configured native integration/device flow suite |
| `pnpm build` | Web/worker builds and native export/config validation |
| `pnpm env:local` | (M2) Write git-ignored `.env.local` files for web, worker, mobile and tests from the LOCAL Supabase stack |
| `pnpm db:plans` | (M2) Load pilot-scale data in a rolled-back transaction and print hot-query plans (no data left behind) |
| `pnpm demo:worker-crash` | (M2) Hard-kill a worker mid-job and show lease-expiry recovery with exactly-once effect |

Milestone 2 status (26 October 2026): `pnpm test:integration` runs against the local PostgreSQL started by `pnpm db:start`; `pnpm test:e2e` needs the same stack plus Mailpit for emailed codes. Results are in `tasks/current/HANDOFF.md`.

Milestone 3 status (27 October 2026): payments run against a **local mock payment gateway** only (`packages/providers/src/mock-gateway.ts`; state in the `mock_gateway` schema that `supabase/seed.sql` creates locally, never in a migration). Its hosted-checkout stand-in and tester console are web pages at `/mock-gateway/checkout/{order}` and `/mock-gateway/console` (404 in production or without config). `pnpm env:local` now also generates, once, the local server secrets `MOCK_GATEWAY_KEY_ID`, `MOCK_GATEWAY_KEY_SECRET`, `MOCK_GATEWAY_WEBHOOK_SECRET` and `ARRIVAL_CODE_SECRET` and reuses them on later runs. Payment truth is decided only by `app.process_payment_observation` (worker role) from provider fetches; see `packages/payments`. No real provider, maps provider or hosted environment exists yet.

A native export does not prove a signed Android or iOS build. Record separate real device tests, Android artifact ID and iOS TestFlight build when available. Windows cannot locally compile an iOS simulator app; use an authorized EAS build or a macOS runner and test on an iPhone. Pin package manager, Node and compatible Expo/React Native versions after checking official requirements.

## Invariants and coding rules

- Use integer paise and INR in pilot. Never compute checkout totals from a client-supplied price. Taxes, commission, fees and cancellation schedules use versioned server configuration with immutable booking snapshots.
- Store instants as UTC timestamps; venue timezone is Asia/Kolkata. Availability uses half-open intervals and includes the cleaning buffer. Business dates use venue local time.
- Lock and constrain inventory in PostgreSQL. Cache, UI polling and payment success callbacks cannot authorize confirmation. Idempotency is scoped by actor, operation and request hash; event ingestion has provider event uniqueness.
- Keep booking, payment, refund, resource readiness, extension and payout states separate. Late captured payment after inventory release creates refund liability. It never revives a cancelled or expired reservation.
- Server authorizes every object and venue. Do not trust user-editable profile role fields. RLS is required on exposed tables; service-role paths require the same explicit tenant checks. Admin and financial access needs MFA and audit.
- Hide no failures: UI supports pending/unknown provider states, safe retries, cancellation policy explanation, no-location permission and offline booking recovery. Offline clients cannot create reservations.
- Native sessions use secure OS storage; web sessions use secure cookies according to the selected Supabase SSR pattern. Allowlist auth/payment return links. Public-prefixed environment variables are bundled into clients and must contain no secrets.
- Use a consistent API error envelope with a safe code, message, retryability and request ID. Redact location, customer contact, tokens, raw webhook payloads and private support details from logs.
- Meaningful tests target business outcomes, especially concurrent checkout, webhook replay/ordering, cross-venue authorization, refund liability and app-return recovery. Do not replace real database race tests with a mocked sequential check.

## Proposed pilot configuration

See the decision register before treating any policy as approved. Proposed values: table booking; 60-minute minimum; 30-minute increments; 240-minute maximum; 15-minute lead; 30-day horizon; 5-minute checkout hold; 10-minute cleanup; 15-minute late grace; reminder 10 minutes before end. Customer cancellation at least 2 hours before start: full amount refund; less than 2 hours: none, except a documented service recovery or applicable obligation. Venue-caused cancellation: full refund. No show never silently frees paid time for resale. No automatic overstay charge.

## References

Read official dependency documentation during implementation; planning does not pin a future SDK version. Claude project context behavior is described in [Anthropic guidance](https://support.claude.com/en/articles/14553240-give-claude-context-claude-md-and-better-prompts). Expo recommends [development builds](https://docs.expo.dev/develop/development-builds/introduction/) for native integrations. Next.js supports a [Node.js server deployment](https://nextjs.org/docs/app/getting-started/deploying). Checked 25 October 2026.
