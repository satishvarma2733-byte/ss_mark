// Integration-test fixtures against the LOCAL database. Each test creates its own fictional venue/users with random IDs,
// so tests are isolated without deleting history (bookings/events are append-only by design).
import { randomUUID } from "node:crypto";
import {
  asUser, createBookingHold, createDb, createQuote, type HoldResult, type QuoteResult, type Sql, type VerifiedClaims
} from "@simply-sit/db";
import type { PaymentServices } from "@simply-sit/payments";
import { loadArrivalSecret, loadMockGatewayConfig, MockGateway, type MockGatewayFaults } from "@simply-sit/providers";

export function requireLocalDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing: start the stack (pnpm db:start) and run pnpm env:local");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("Integration tests only run against a local database");
  return url;
}

// Connects as the local `postgres` role (BYPASSRLS) for fixture setup; tests switch roles via asAnon/asUser/asWorker.
export function openDb(max = 20): Sql {
  return createDb(requireLocalDatabaseUrl(), { max });
}

export type TestUser = { authUserId: string; profileId: string; email: string };

export async function createUser(sql: Sql, opts: { acceptTerms?: boolean; label?: string } = {}): Promise<TestUser> {
  const authUserId = randomUUID();
  const email = `${opts.label ?? "user"}.${authUserId.slice(0, 8)}@example.test`;
  await sql`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
                            raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
                            email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', ${authUserId}::uuid, 'authenticated', 'authenticated', ${email}, '',
            now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')`;
  const [profile] = await sql`select id from public.profiles where auth_user_id = ${authUserId}::uuid`;
  if (!profile) throw new Error("profile trigger did not run");
  if (opts.acceptTerms !== false) {
    await sql`update public.profiles set terms_version = 'draft-terms-2026-10-26', terms_accepted_at = now(),
              privacy_version = 'draft-privacy-2026-10-26' where id = ${profile.id as string}::uuid`;
  }
  return { authUserId, profileId: profile.id as string, email };
}

export function claimsFor(user: TestUser, opts: { aal?: "aal1" | "aal2"; verifiedSecondsAgo?: number } = {}): VerifiedClaims {
  const verifiedAt = Math.floor(Date.now() / 1000) - (opts.verifiedSecondsAgo ?? 60);
  return {
    sub: user.authUserId,
    role: "authenticated",
    aal: opts.aal ?? "aal1",
    amr: [{ method: "otp", timestamp: verifiedAt }]
  };
}

export type PolicyOverrides = Partial<{
  increment_minutes: number;
  lead_minutes: number;
  max_horizon_days: number;
  buffer_minutes: number;
  hold_minutes: number;
  byo_details: string;
  late_refund_bps: number;
  end_reminder_minutes: number;
}>;

export type TestVenue = { venueId: string; slug: string; partnerId: string; policyId: string; tableIds: string[] };

export async function createVenue(
  sql: Sql,
  opts: {
    tables?: { capacity: number; hourlyPaise: number }[];
    hours?: { weekdays: number[]; opens: string; closes: string };
    policy?: PolicyOverrides;
    publish?: boolean;
    feeConfigVersion?: string;
  } = {}
): Promise<TestVenue> {
  const suffix = randomUUID().slice(0, 8);
  const slug = `test-venue-${suffix}`;
  const [partner] = await sql`
    insert into public.partners (legal_name, display_name, status, is_synthetic)
    values (${"TEST Partner " + suffix}, ${"TEST Partner " + suffix}, 'APPROVED', true) returning id`;
  const [venue] = await sql`
    insert into public.venues (partner_id, category_code, name, slug, address, locality, location, is_synthetic)
    values (${partner!.id as string}::uuid, 'CAFE', ${"TEST Venue " + suffix}, ${slug}, 'Test address (fictional)',
            'Test locality (fictional)',
            extensions.st_setsrid(extensions.st_makepoint(77.62, 12.93), 4326)::extensions.geography, true)
    returning id`;
  const venueId = venue!.id as string;
  const p = opts.policy ?? {};
  const [policy] = await sql`
    insert into public.venue_policies (
      venue_id, policy_version, status, source_policy_version, byo_food, byo_details, outside_delivery,
      handover_instructions, house_rules, cancel_cutoff_minutes, early_refund_bps, late_refund_bps, no_show_refund_bps,
      minimum_minutes, increment_minutes, maximum_minutes, buffer_minutes, grace_minutes, lead_minutes, max_horizon_days,
      hold_minutes, quote_ttl_minutes, end_reminder_minutes, effective_from, accepted_terms_version)
    values (${venueId}::uuid, 1, 'PUBLISHED', 'proposed-2026-10-25', 'ALLOWED', ${p.byo_details ?? "Test food rule"},
            'ALLOWED', 'Test handover', 'Test rules', 120, 10000, ${p.late_refund_bps ?? 0}, 0, 60, ${p.increment_minutes ?? 30}, 240, ${p.buffer_minutes ?? 10}, 15,
            ${p.lead_minutes ?? 15}, ${p.max_horizon_days ?? 30}, ${p.hold_minutes ?? 5}, 5, ${p.end_reminder_minutes ?? 10}, '2026-01-01T00:00:00Z',
            'draft-terms-2026-10-26')
    returning id`;
  const tables = opts.tables ?? [{ capacity: 4, hourlyPaise: 30000 }];
  const tableIds: string[] = [];
  for (const [index, table] of tables.entries()) {
    const [resource] = await sql`
      insert into public.resources (venue_id, label, capacity)
      values (${venueId}::uuid, ${`Test table ${index + 1}`}, ${table.capacity}) returning id`;
    await sql`
      insert into public.resource_rates (resource_id, rate_version, hourly_paise, effective_from, fee_config_version)
      values (${resource!.id as string}::uuid, 1, ${table.hourlyPaise}, '2026-01-01T00:00:00Z',
              ${opts.feeConfigVersion ?? "SANDBOX-ZERO-2026-10"})`;
    tableIds.push(resource!.id as string);
  }
  const hours = opts.hours ?? { weekdays: [0, 1, 2, 3, 4, 5, 6], opens: "08:00", closes: "22:00" };
  for (const weekday of hours.weekdays) {
    await sql`
      insert into public.opening_periods (venue_id, weekday, opens_local, closes_local, closes_next_day, schedule_version)
      values (${venueId}::uuid, ${weekday}, ${hours.opens}::time, ${hours.closes}::time,
              ${hours.closes}::time <= ${hours.opens}::time, 1)`;
  }
  if (opts.publish !== false) {
    await sql`update public.venues set active_policy_id = ${policy!.id as string}::uuid, status = 'PUBLISHED', published_at = now()
              where id = ${venueId}::uuid`;
  }
  return { venueId, slug, partnerId: partner!.id as string, policyId: policy!.id as string, tableIds };
}

export async function grantVenueRole(sql: Sql, venueId: string, user: TestUser, role: "STAFF" | "MANAGER" | "OWNER") {
  await sql`insert into public.venue_memberships (venue_id, user_id, role, status, accepted_at)
            values (${venueId}::uuid, ${user.profileId}::uuid, ${role}, 'ACTIVE', now())`;
}

export async function grantPlatformRole(sql: Sql, user: TestUser, role: "SUPPORT" | "FINANCE" | "SUPERADMIN") {
  await sql`insert into public.platform_memberships (user_id, role, status, reason)
            values (${user.profileId}::uuid, ${role}, 'ACTIVE', 'integration test fixture')`;
}

// Asia/Kolkata is a fixed UTC+05:30 offset (no DST). Returns the UTC ISO instant for a venue-local date/time.
const IST_OFFSET_MINUTES = 330;
export function istDate(daysAhead: number): string {
  const nowIst = new Date(Date.now() + IST_OFFSET_MINUTES * 60_000);
  nowIst.setUTCDate(nowIst.getUTCDate() + daysAhead);
  return nowIst.toISOString().slice(0, 10);
}
export function istInstant(date: string, time: string): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const utc = new Date(`${date}T00:00:00.000Z`);
  utc.setUTCMinutes(h * 60 + m - IST_OFFSET_MINUTES);
  return utc.toISOString();
}
export function istSlot(daysAhead: number, time: string): string {
  return istInstant(istDate(daysAhead), time);
}
// Next date (>= 1 day ahead) in IST whose weekday (0 = Sunday) matches.
export function nextIstWeekday(weekday: number): string {
  for (let d = 1; d <= 8; d += 1) {
    const date = istDate(d);
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === weekday) return date;
  }
  throw new Error("unreachable");
}

export async function expectDomainError(promise: Promise<unknown>, code: string): Promise<Record<string, unknown>> {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; details?: Record<string, unknown>; message?: string };
    if (e.code !== code) throw new Error(`expected ${code}, got ${e.code ?? "no code"}: ${e.message ?? String(error)}`);
    return e.details ?? {};
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}

// Local mock gateway + arrival secret from the git-ignored .env.local (written by pnpm env:local).
export function paymentServices(sql: Sql, faults?: MockGatewayFaults): PaymentServices & { gateway: MockGateway } {
  const gateway = new MockGateway(sql, loadMockGatewayConfig(process.env), faults);
  return { sql, gateway, arrivalSecret: loadArrivalSecret(process.env) };
}

// Quote + hold for one table as the given customer.
export async function holdTable(
  sql: Sql,
  user: TestUser,
  venue: TestVenue,
  startAt: string,
  opts: { table?: number; minutes?: number; party?: number } = {}
): Promise<HoldResult & { quote: QuoteResult }> {
  const claims = claimsFor(user);
  const quote = await asUser(sql, claims, (tx) =>
    createQuote(tx, {
      venue_id: venue.venueId,
      resource_id: venue.tableIds[opts.table ?? 0]!,
      start_at: startAt,
      duration_minutes: opts.minutes ?? 60,
      party_size: opts.party ?? 2
    }));
  const hold = await asUser(sql, claims, (tx) =>
    createBookingHold(tx, { quote_id: quote.quote_id, accepted_policy_hash: quote.policy_hash, expected_quote_total_paise: quote.price_snapshot.total_paise }));
  return { ...hold, quote };
}

// First instant on a minute grid (UTC-aligned; IST is +05:30 so 5/30-minute grids align) at least `minutesAhead` away.
export function nextGridSlot(gridMinutes: number, minutesAhead: number): string {
  const step = gridMinutes * 60_000;
  return new Date(Math.ceil((Date.now() + minutesAhead * 60_000) / step) * step).toISOString();
}

// A 60-minute booking start inside the 2-hour cancellation cutoff whose booking + 10-minute cleaning buffer never runs
// past a 23:55 IST close (test venues): the next 5-minute slot at least `leadMinutes` away, or the next IST midnight
// when that slot would cross closing time (still under two hours ahead).
export function lateWindowSlot(leadMinutes = 30, bufferMinutes = 10): string {
  const start = Date.parse(nextGridSlot(5, leadMinutes));
  const istMidnightAfter = (t: number) => Math.ceil((t + IST_OFFSET_MINUTES * 60_000) / 86_400_000) * 86_400_000 - IST_OFFSET_MINUTES * 60_000;
  const close = istMidnightAfter(start) - 5 * 60_000;
  return new Date(start + (60 + bufferMinutes) * 60_000 > close ? istMidnightAfter(start) : start).toISOString();
}

// Test-only clock travel: makes a hold due now without waiting (the deadline column is not a snapshot field).
export async function makeHoldDue(sql: Sql, bookingId: string) {
  await sql`update public.bookings set hold_expires_at = clock_timestamp() - interval '1 second' where id = ${bookingId}::uuid`;
  await sql`update public.inventory_claims set expires_at = clock_timestamp() - interval '1 second'
            where booking_id = ${bookingId}::uuid and kind = 'BOOKING' and active`;
}
