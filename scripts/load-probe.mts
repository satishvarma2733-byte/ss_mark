// M5.3 load probe (docs/08 T21) against a LOCAL production build (`next start`) and the LOCAL Supabase stack only.
// 50 concurrent browsing sessions (search, venue detail, availability, server-rendered pages) run while 10 customers
// each complete hold -> checkout -> mock capture -> verify three times, then 10 customers race for one table.
// Fictional fixtures; the payment provider is the local MOCK. Writes evidence JSON + Markdown.
// A session waits 1-3 s between actions (think time; 0 turns this into a stress test with back-to-back requests).
// The venue uses a booking grid of `grid` minutes (30 is the default policy; 5 is the finest a partner can choose).
// Usage: npx tsx scripts/load-probe.mts [baseUrl=http://localhost:3100] [seconds=45] [outDir=tasks/current/evidence/m5] [thinkMs=1000-3000] [grid=30]
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import * as db from "@simply-sit/db";
import * as providers from "@simply-sit/providers";
import * as apiClient from "../packages/api-client/src/index.ts";

process.loadEnvFile(new URL("../.env.local", import.meta.url));

const base = process.argv[2] ?? "http://localhost:3100";
const seconds = Number(process.argv[3] ?? 45);
const outDir = process.argv[4] ?? "tasks/current/evidence/m5";
const [thinkMin, thinkMax] = (process.argv[5] ?? "1000-3000").split("-").map(Number) as [number, number];
const grid = Number(process.argv[6] ?? 30);
const think = () => new Promise((r) => setTimeout(r, thinkMin + Math.random() * (thinkMax - thinkMin)));
for (const url of [base, process.env.DATABASE_URL!, process.env.SUPABASE_URL!]) {
  if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error(`local stack only: ${url}`);
}
const sql = db.createDb(process.env.DATABASE_URL!, { max: 8 });
const gateway = new providers.MockGateway(sql, providers.loadMockGatewayConfig(process.env));

// ---------------------------------------------------------------------------------------------------- fixtures
async function quickVenue(tables: number) {
  const suffix = randomUUID().slice(0, 8);
  const [partner] = await sql`insert into public.partners (legal_name, display_name, status, is_synthetic)
    values (${"LOAD Partner " + suffix}, ${"LOAD Partner " + suffix}, 'APPROVED', true) returning id`;
  const [venue] = await sql`insert into public.venues (partner_id, category_code, name, slug, description, address, locality, location, is_synthetic)
    values (${partner!.id}::uuid, 'CAFE', ${"LOAD Cafe " + suffix}, ${"load-cafe-" + suffix}, 'Fictional load-test venue.',
            'Load address (fictional)', 'Koramangala (fictional)',
            extensions.st_setsrid(extensions.st_makepoint(77.6245, 12.9352), 4326)::extensions.geography, true) returning id, slug`;
  const [policy] = await sql`insert into public.venue_policies (
      venue_id, policy_version, status, source_policy_version, byo_food, byo_details, outside_delivery, handover_instructions,
      house_rules, cancel_cutoff_minutes, early_refund_bps, late_refund_bps, no_show_refund_bps, minimum_minutes, increment_minutes,
      maximum_minutes, buffer_minutes, grace_minutes, lead_minutes, max_horizon_days, hold_minutes, quote_ttl_minutes,
      end_reminder_minutes, effective_from, accepted_terms_version)
    values (${venue!.id}::uuid, 1, 'PUBLISHED', 'load', 'ALLOWED', 'Load test rule.', 'ALLOWED', 'Show your code (load).',
            'Load rules.', 120, 10000, 0, 0, 60, ${grid}, 240, 10, 15, 0, 30, 5, 5, 10, '2026-01-01T00:00:00Z', 'draft-terms-2026-10-26')
    returning id`;
  const ids: string[] = [];
  for (let i = 0; i < tables; i += 1) {
    const [t] = await sql`insert into public.resources (venue_id, label, capacity) values (${venue!.id}::uuid, ${`Load table ${i + 1}`}, 4) returning id`;
    await sql`insert into public.resource_rates (resource_id, rate_version, hourly_paise, effective_from, fee_config_version)
              values (${t!.id}::uuid, 1, 30000, '2026-01-01T00:00:00Z', 'SANDBOX-ZERO-2026-10')`;
    ids.push(t!.id);
  }
  for (let d = 0; d < 7; d += 1) {
    await sql`insert into public.opening_periods (venue_id, weekday, opens_local, closes_local, closes_next_day, schedule_version)
              values (${venue!.id}::uuid, ${d}, '04:00', '03:55', true, 1)`;
  }
  await sql`update public.venues set active_policy_id = ${policy!.id}::uuid, status = 'PUBLISHED', published_at = now() where id = ${venue!.id}::uuid`;
  return { venueId: venue!.id as string, slug: venue!.slug as string, tableIds: ids };
}

async function customer() {
  const id = randomUUID();
  const email = `load.${id.slice(0, 8)}@example.test`;
  await sql`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
              raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
            values ('00000000-0000-0000-0000-000000000000', ${id}::uuid, 'authenticated', 'authenticated', ${email}, '', now(),
                    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')`;
  await sql`insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
            values (gen_random_uuid(), ${id}::uuid, ${id}, ${sql.json({ sub: id, email, email_verified: true })}, 'email', now(), now(), now())`;
  await sql`update public.profiles set terms_version = 'draft-terms-2026-10-26', terms_accepted_at = now(), privacy_version = 'draft-privacy-2026-10-26'
            where auth_user_id = ${id}::uuid`;
  const auth = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const sentAt = Date.now();
  const { error } = await auth.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) throw error;
  let code: string | null = null;
  for (let i = 0; i < 40 && !code; i += 1) {
    const list = await (await fetch(`${process.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
    const recent = (list.messages ?? []).filter((m: { Created: string }) => Date.parse(m.Created) >= sentAt - 2000);
    if (recent[0]) {
      const msg = await (await fetch(`${process.env.MAILPIT_URL}/api/v1/message/${recent[0].ID}`)).json();
      code = /\b(\d{6})\b/.exec(`${msg.Text ?? ""} ${msg.HTML ?? ""}`)?.[1] ?? null;
    }
    if (!code) await new Promise((r) => setTimeout(r, 250));
  }
  const { data, error: verifyError } = await auth.auth.verifyOtp({ email, token: code!, type: "email" });
  if (verifyError || !data.session) throw verifyError ?? new Error("no session");
  const token = data.session.access_token as string;
  return apiClient.createSimplySitClient({ baseUrl: base, getAccessToken: async () => token });
}

// ---------------------------------------------------------------------------------------------------- measurement
const samples = new Map<string, number[]>();
const errors = new Map<string, number>();
async function timed<T>(label: string, work: () => Promise<T>): Promise<T | undefined> {
  const start = performance.now();
  try {
    const result = await work();
    (samples.get(label) ?? samples.set(label, []).get(label)!).push(performance.now() - start);
    return result;
  } catch (error) {
    errors.set(label, (errors.get(label) ?? 0) + 1);
    if ((errors.get(label) ?? 0) <= 3) console.warn(`[load] ${label} failed: ${(error as { code?: string; message?: string }).code ?? (error as Error).message}`);
    return undefined;
  }
}
const pct = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]! : NaN;
};
async function page(path: string) {
  const response = await fetch(`${base}${path}`);
  await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

// ---------------------------------------------------------------------------------------------------- run
const venue = await quickVenue(12);
console.info(`[load] venue ${venue.slug}; signing in 10 customers`);
const customers = [];
for (let i = 0; i < 10; i += 1) customers.push(await customer());
const anon = apiClient.createSimplySitClient({ baseUrl: base });
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const deadline = Date.now() + seconds * 1000;

async function browser() {
  const steps = [
    () => timed("GET /api/v1/venues (search)", () => anon.searchVenues({ lat: 12.9352, lng: 77.6245 })),
    () => timed("GET /api/v1/venues/{id}", () => anon.getVenue(venue.venueId)),
    () => timed("GET /api/v1/venues/{id}/availability", () => anon.getAvailability(venue.venueId, { date: today, duration_minutes: 60, party_size: 2 })),
    () => timed("GET / (page)", () => page("/")),
    () => timed("GET /venues/{slug} (page)", () => page(`/venues/${venue.slug}`))
  ];
  let i = Math.floor(Math.random() * steps.length);
  while (Date.now() < deadline) {
    await steps[i++ % steps.length]!();
    await think();
  }
}

async function buyer(client: ReturnType<typeof apiClient.createSimplySitClient>, table: string, rounds: number) {
  for (let r = 0; r < rounds; r += 1) {
    const step = grid * 60_000;
    // Each round books a later slot on the buyer's own table (60 min + 10 min cleaning, rounded up to the grid).
    const start = new Date(Math.ceil((Date.now() + (30 + r * 90) * 60_000) / step) * step).toISOString();
    await think();
    const quote = await timed("POST /quotes", () => client.createQuote({ venue_id: venue.venueId, resource_id: table, start_at: start, duration_minutes: 60, party_size: 2 }));
    if (!quote) continue;
    const hold = await timed("POST /booking-holds", () => client.createHold(quote, randomUUID()));
    if (!hold) continue;
    const order = await timed("POST /bookings/{id}/checkout", () => client.startCheckout(hold.booking_id, hold.version, "web"));
    if (!order?.checkout) continue;
    const payment = await gateway.simulatePayment(order.checkout.provider_order_id, "capture");
    await timed("POST /payment-orders/{id}/verify", () => client.verifyPayment(order.payment_order_id, { provider_payment_id: payment.providerPaymentId }));
  }
}

const startedAt = new Date().toISOString();
await Promise.all([
  ...Array.from({ length: 50 }, () => browser()),
  ...customers.map((c, i) => buyer(c, venue.tableIds[i]!, 3))
]);

// Ten customers race for the same table and time: exactly one hold may win.
const contested = new Date(Math.ceil((Date.now() + 600 * 60_000) / (grid * 60_000)) * (grid * 60_000)).toISOString();
const race = await Promise.allSettled(customers.map(async (c) => {
  const quote = await c.createQuote({ venue_id: venue.venueId, resource_id: venue.tableIds[11]!, start_at: contested, duration_minutes: 60, party_size: 2 });
  return c.createHold(quote, randomUUID());
}));
const raceWins = race.filter((r) => r.status === "fulfilled").length;
const raceCodes = race.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => (r.reason as { code?: string }).code ?? "ERROR");

const [{ overlaps }] = await sql`
  select count(*)::int as overlaps from public.inventory_claims a join public.inventory_claims b
    on a.resource_id = b.resource_id and a.id < b.id and a.active and b.active and a.blocked_range && b.blocked_range`;
const [{ confirmed }] = await sql`select count(*)::int as confirmed from public.bookings where venue_id = ${venue.venueId}::uuid and status = 'CONFIRMED'`;
const [{ unallocated }] = await sql`select count(*)::int as unallocated from public.payment_attempts a join public.bookings b on b.id = a.booking_id
                                    where b.venue_id = ${venue.venueId}::uuid and a.state = 'CAPTURED' and a.allocation_state = 'UNALLOCATED'`;

const rows = [...samples.entries()].map(([label, values]) => ({
  label, count: values.length, errors: errors.get(label) ?? 0,
  p50_ms: Math.round(pct(values, 50)), p95_ms: Math.round(pct(values, 95)), max_ms: Math.round(Math.max(...values))
}));
for (const [label, count] of errors) if (!samples.has(label)) rows.push({ label, count: 0, errors: count, p50_ms: NaN, p95_ms: NaN, max_ms: NaN });
const result = {
  started_at: startedAt, base, seconds, sessions: 50, checkout_customers: 10, think_ms: [thinkMin, thinkMax], grid_minutes: grid, rows,
  race: { contenders: customers.length, wins: raceWins, refusals: raceCodes },
  invariants: { overlapping_active_claims: overlaps, confirmed_bookings: confirmed, captured_unallocated: unallocated }
};
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/load-probe.json`, JSON.stringify(result, null, 2));
const md = [
  `# Load probe ${startedAt}`, "", `Base ${base}, ${seconds}s, 50 browsing sessions + 10 checkout customers (3 rounds each), think time ${thinkMin}-${thinkMax} ms, 12 tables on a ${grid}-minute grid. LOCAL stack, MOCK provider.`, "",
  "| Request | Count | Errors | p50 ms | p95 ms | max ms |", "| --- | --- | --- | --- | --- | --- |",
  ...rows.map((r) => `| ${r.label} | ${r.count} | ${r.errors} | ${r.p50_ms} | ${r.p95_ms} | ${r.max_ms} |`), "",
  `Race for one table: ${raceWins} of ${customers.length} won; others: ${[...new Set(raceCodes)].join(", ")}.`,
  `Invariants: overlapping active claims ${overlaps}; confirmed bookings ${confirmed}; captured but unallocated ${unallocated}.`
].join("\n");
writeFileSync(`${outDir}/load-probe.md`, `${md}\n`);
console.info(md);
await sql.end();
