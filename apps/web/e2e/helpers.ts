// E2E helpers for the LOCAL stack only: fixture users via SQL, emailed codes from Mailpit, and RFC 6238 TOTP codes.
import { createHash, createHmac, randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";

// Signs in through the real UI: request a code, read it from the local Mailpit inbox, verify.
export async function signInWithEmailCode(page: Page, email: string, opts: { acceptTerms?: boolean } = {}) {
  await expect(page.getByRole("heading", { name: "Sign in / Create account" })).toBeVisible();
  // The form is React-controlled: text typed before hydration is discarded and the form then submits empty
  // ("Some details need attention"). Wait for the page, then confirm the value held before sending.
  await page.waitForLoadState("networkidle");
  await expect(async () => {
    await page.getByLabel("Email address").fill(email);
    await page.waitForTimeout(200);
    await expect(page.getByLabel("Email address")).toHaveValue(email, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  if (opts.acceptTerms) await page.getByRole("checkbox").check();
  const sentAt = Date.now();
  await page.getByRole("button", { name: "Send verification code" }).click();
  await expect(page.getByRole("status")).toContainText("a code is on its way");
  const code = await latestCode(email, sentAt);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify & continue" }).click();
}

// Reads the @supabase/ssr session cookie (raw or "base64-" encoded, possibly split into .0/.1 chunks).
type StoredSession = { access_token: string; refresh_token: string; expires_at: number; [key: string]: unknown };
const BASE64_PREFIX = "base64-";
const CHUNK = 3180;

export async function readSessionCookie(context: BrowserContext): Promise<{ name: string; session: StoredSession; encoded: boolean }> {
  const cookies = (await context.cookies()).filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name));
  if (cookies.length === 0) throw new Error("no session cookie");
  const name = cookies[0]!.name.replace(/\.\d+$/, "");
  const value = cookies.some((c) => c.name === name)
    ? cookies.find((c) => c.name === name)!.value
    : cookies.filter((c) => c.name.startsWith(`${name}.`))
        .sort((a, b) => Number(a.name.split(".").pop()) - Number(b.name.split(".").pop()))
        .map((c) => c.value).join("");
  const encoded = value.startsWith(BASE64_PREFIX);
  const json = encoded ? Buffer.from(value.slice(BASE64_PREFIX.length), "base64url").toString("utf8") : decodeURIComponent(value);
  return { name, session: JSON.parse(json) as StoredSession, encoded };
}

export async function writeSessionCookie(context: BrowserContext, baseURL: string, name: string, session: StoredSession, encoded: boolean) {
  const json = JSON.stringify(session);
  const value = encoded ? BASE64_PREFIX + Buffer.from(json, "utf8").toString("base64url") : encodeURIComponent(json);
  const existing = (await context.cookies()).filter((c) => c.name === name || c.name.startsWith(`${name}.`));
  await context.clearCookies({ name: new RegExp(`^${name.replace(/[-.]/g, "\\$&")}(\\.\\d+)?$`) });
  const template = existing[0]!;
  const chunks = value.length <= CHUNK ? [[name, value]] : Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) => [`${name}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK)]);
  await context.addCookies(chunks.map(([n, v]) => ({
    name: n!, value: v!, url: baseURL, httpOnly: template.httpOnly, sameSite: template.sameSite, secure: template.secure
  })));
}

function localUrl(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} missing: run pnpm env:local`);
  const host = new URL(value).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`${name} must point at the local stack`);
  return value;
}

export const CAFE_VENUE_ID = "22222222-2222-4222-8222-000000000001";
export const CAFE_TABLE_1 = "33333333-3333-4333-8333-000000000011";
export const LOUNGE_VENUE_ID = "22222222-2222-4222-8222-000000000002";

let sqlClient: postgres.Sql | undefined;
export function db() {
  sqlClient ??= postgres(localUrl("DATABASE_URL"), { max: 2, onnotice: () => {} });
  return sqlClient;
}

// A fresh fictional account per test avoids the 60-second resend cooldown and keeps tests independent.
export async function createFixtureUser(opts: { venueRole?: { venueId: string; role: "STAFF" | "MANAGER" }; acceptTerms?: boolean } = {}) {
  const id = randomUUID();
  const email = `e2e.${id.slice(0, 8)}@example.test`;
  const sql = db();
  await sql`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
                            raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
                            email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', ${id}::uuid, 'authenticated', 'authenticated', ${email}, '', now(),
            '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')`;
  await sql`
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), ${id}::uuid, ${id}, ${sql.json({ sub: id, email, email_verified: true })}, 'email', now(), now(), now())`;
  if (opts.acceptTerms !== false) {
    await sql`update public.profiles set terms_version = 'draft-terms-2026-10-26', terms_accepted_at = now(),
              privacy_version = 'draft-privacy-2026-10-26' where auth_user_id = ${id}::uuid`;
  }
  if (opts.venueRole) {
    await sql`insert into public.venue_memberships (venue_id, user_id, role, status, accepted_at)
              select ${opts.venueRole.venueId}::uuid, p.id, ${opts.venueRole.role}, 'ACTIVE', now()
              from public.profiles p where p.auth_user_id = ${id}::uuid`;
  }
  return { id, email };
}

// Stand-in for the worker's invitation email (the e2e stack runs no worker): records the hash of the link token as
// apps/worker does before sending, and returns the emailed link. Same derivation as packages/domain invitation.ts.
export async function deliverInvitationLink(invitationId: string): Promise<string> {
  const secret = process.env.ARRIVAL_CODE_SECRET;
  if (!secret) throw new Error("ARRIVAL_CODE_SECRET missing: run pnpm env:local");
  const token = createHmac("sha256", secret).update(`invitation-token:v1:${invitationId}`).digest("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  await db().begin(async (tx) => {
    await tx.unsafe("set local role simply_worker");
    await tx`select app.record_invitation_token(${invitationId}::uuid, ${tokenHash})`;
  });
  return `/partner?${new URLSearchParams({ invitation: invitationId, token }).toString()}`;
}

// Polls the local Mailpit inbox for the newest sign-in code sent to this address.
export async function latestCode(email: string, after: number): Promise<string> {
  const base = localUrl("MAILPIT_URL");
  for (let i = 0; i < 40; i += 1) {
    const list = (await (await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json()) as {
      messages?: { ID: string; Created: string }[];
    };
    const recent = (list.messages ?? []).filter((m) => Date.parse(m.Created) >= after - 2000);
    if (recent[0]) {
      const message = (await (await fetch(`${base}/api/v1/message/${recent[0].ID}`)).json()) as { Text?: string; HTML?: string };
      const match = /\b(\d{6})\b/.exec(`${message.Text ?? ""} ${message.HTML ?? ""}`);
      if (match) return match[1]!;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no sign-in code arrived for ${email}`);
}

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = "";
  for (const char of clean) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error("invalid base32");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

// RFC 6238 TOTP (SHA-1, 30-second step, 6 digits), as used by authenticator apps.
export function totp(secret: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return (binary % 1_000_000).toString().padStart(6, "0");
}

// Asia/Kolkata local date/time -> UTC ISO instant (fixed +05:30 offset).
export function istSlot(daysAhead: number, time: string): string {
  const nowIst = new Date(Date.now() + 330 * 60_000);
  nowIst.setUTCDate(nowIst.getUTCDate() + daysAhead);
  const [h, m] = time.split(":").map(Number) as [number, number];
  const utc = new Date(`${nowIst.toISOString().slice(0, 10)}T00:00:00.000Z`);
  utc.setUTCMinutes(h * 60 + m - 330);
  return utc.toISOString();
}

// A fictional quick-turn venue for arrival tests: 5-minute grid and no lead time, so a booking can start within
// minutes and its check-in window is already open.
// Open 04:00-03:55 the next day (overnight) by default, so bookings that start "soon" - and extensions of them - work
// at any time except roughly 03:00-04:00 IST; overnight: false gives the old 00:00-23:55 day.
export async function createQuickVenue(opts: { tables?: number; overnight?: boolean } = {}) {
  const overnight = opts.overnight ?? true;
  const sql = db();
  const suffix = randomUUID().slice(0, 8);
  const slug = `e2e-quick-${suffix}`;
  const [partner] = await sql`
    insert into public.partners (legal_name, display_name, status, is_synthetic)
    values (${"E2E Partner " + suffix}, ${"E2E Partner " + suffix}, 'APPROVED', true) returning id`;
  const [venue] = await sql`
    insert into public.venues (partner_id, category_code, name, slug, description, address, locality, location, is_synthetic)
    values (${partner!.id as string}::uuid, 'CAFE', ${"E2E Quick Cafe " + suffix}, ${slug}, 'Fictional e2e venue.',
            'E2E address (fictional)', 'E2E locality (fictional)',
            -- About 140 m from DEMO Cafe Koramangala (77.6245, 12.9352): close enough for Koramangala searches, never tied
            -- with it on distance, so leftover e2e venues cannot push the demo cafe off the first results page.
            extensions.st_setsrid(extensions.st_makepoint(77.6255, 12.9360), 4326)::extensions.geography, true)
    returning id`;
  const venueId = venue!.id as string;
  const [policy] = await sql`
    insert into public.venue_policies (
      venue_id, policy_version, status, source_policy_version, byo_food, byo_details, outside_delivery,
      handover_instructions, house_rules, cancel_cutoff_minutes, early_refund_bps, late_refund_bps, no_show_refund_bps,
      minimum_minutes, increment_minutes, maximum_minutes, buffer_minutes, grace_minutes, lead_minutes, max_horizon_days,
      hold_minutes, quote_ttl_minutes, end_reminder_minutes, effective_from, accepted_terms_version)
    values (${venueId}::uuid, 1, 'PUBLISHED', 'e2e-quick', 'ALLOWED', 'E2E: outside food allowed.', 'ALLOWED',
            'Show your QR code (e2e).', 'E2E house rules.', 120, 10000, 0, 0, 60, 5, 240, 10, 15, 0, 30, 5, 5, 10,
            '2026-01-01T00:00:00Z', 'draft-terms-2026-10-26')
    returning id`;
  const tableIds: string[] = [];
  for (let i = 0; i < (opts.tables ?? 2); i += 1) {
    const [table] = await sql`insert into public.resources (venue_id, label, capacity) values (${venueId}::uuid, ${`Quick table ${i + 1}`}, 4) returning id`;
    await sql`insert into public.resource_rates (resource_id, rate_version, hourly_paise, effective_from, fee_config_version)
              values (${table!.id as string}::uuid, 1, 30000, '2026-01-01T00:00:00Z', 'SANDBOX-ZERO-2026-10')`;
    tableIds.push(table!.id as string);
  }
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const [opens, closes] = overnight ? ["04:00", "03:55"] : ["00:00", "23:55"];
    await sql`insert into public.opening_periods (venue_id, weekday, opens_local, closes_local, closes_next_day, schedule_version)
              values (${venueId}::uuid, ${weekday}, ${opens}::time, ${closes}::time, ${overnight}, 1)`;
  }
  await sql`update public.venues set active_policy_id = ${policy!.id as string}::uuid, status = 'PUBLISHED', published_at = now()
            where id = ${venueId}::uuid`;
  return { venueId, slug, tableIds };
}

// The next start on a 5-minute grid at least one minute away (UTC grid aligns with IST's +05:30).
export function nextQuickSlot(minutesAhead = 1): string {
  const step = 5 * 60_000;
  return new Date(Math.ceil((Date.now() + minutesAhead * 60_000) / step) * step).toISOString();
}

// Same-origin API calls with the page's cookie session (what the web UI's fetch does).
export async function apiPost(page: Page, path: string, data: unknown, extra: Record<string, string> = {}) {
  const response = await page.request.post(path, { data, headers: { origin: "http://localhost:3100", ...extra } });
  return { status: response.status(), body: (await response.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: { code: string } } };
}

// Signs in through the UI and enrols TOTP so the session is aal2 (staff portal requirement).
export async function signInWithMfa(page: Page, email: string, redirectPath: string) {
  await page.goto(`/sign-in?redirect_path=${encodeURIComponent(redirectPath)}`);
  await signInWithEmailCode(page, email);
  await completeMfaEnrolment(page);
}

// From a portal's "verify it is you" screen: enrol a TOTP authenticator and step the session up to aal2.
export async function completeMfaEnrolment(page: Page) {
  await expect(page.getByTestId("portal-mfa-required")).toBeVisible();
  await page.getByRole("link", { name: "Continue to authenticator check" }).click();
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  const secret = (await page.getByTestId("mfa-secret").textContent())!.trim();
  await page.getByLabel("6-digit authenticator code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  // The verify call steps the session up and then redirects; navigating earlier would cancel it.
  await page.waitForURL((url) => !url.pathname.startsWith("/account/security"));
}

export async function grantPlatformRole(userId: string, role: "SUPPORT" | "FINANCE" | "SUPERADMIN") {
  await db()`insert into public.platform_memberships (user_id, role, status, reason)
             select p.id, ${role}, 'ACTIVE', 'e2e fixture' from public.profiles p where p.auth_user_id = ${userId}::uuid`;
}

// Full-page screenshot for checkpoint evidence, only when E2E_EVIDENCE_DIR is set (normal runs write nothing).
export async function evidence(page: Page, name: string) {
  const dir = process.env.E2E_EVIDENCE_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

// A 1x1 PNG for photo uploads (fictional content).
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

// Test-only clock travel: makes a hold due now (deadline column only; snapshots are untouched).
export async function makeHoldDue(bookingId: string) {
  const sql = db();
  await sql`update public.bookings set hold_expires_at = clock_timestamp() - interval '1 second' where id = ${bookingId}::uuid`;
  await sql`update public.inventory_claims set expires_at = clock_timestamp() - interval '1 second'
            where booking_id = ${bookingId}::uuid and kind = 'BOOKING' and active`;
}

// Customer web flow: UI sign-in, then quote + hold through the same API the UI uses (cookie session), then pay on the
// mock gateway page.
export async function signedInCustomer(page: Page) {
  const customer = await createFixtureUser();
  await page.goto("/sign-in?redirect_path=/bookings");
  await signInWithEmailCode(page, customer.email);
  await expect(page.getByRole("heading", { name: "Your good hours, in one place." })).toBeVisible();
  return customer;
}

// Quote + hold through the same API the UI uses (cookie session), then open checkout.
export async function holdThroughApi(page: Page, venue: { venueId: string; tableIds: string[] }, table = 0, minutesAhead = 1, startAt?: string) {
  const quote = await apiPost(page, "/api/v1/quotes", {
    venue_id: venue.venueId, resource_id: venue.tableIds[table], start_at: startAt ?? nextQuickSlot(minutesAhead), duration_minutes: 60, party_size: 2
  });
  expect(quote.status).toBe(201);
  const q = quote.body.data as { quote_id: string; policy_hash: string; price_snapshot: { total_paise: number } };
  const hold = await apiPost(page, "/api/v1/booking-holds",
    { quote_id: q.quote_id, accepted_policy_hash: q.policy_hash, expected_quote_total_paise: q.price_snapshot.total_paise },
    { "idempotency-key": randomUUID() });
  expect(hold.status).toBe(201);
  return hold.body.data as { booking_id: string; public_ref: string };
}

export async function payOnMockGateway(page: Page, outcome: "mock-pay-success" | "mock-pay-fail" | "mock-pay-authorize", webhook: "now" | "none" = "none") {
  await page.getByTestId("pay").click();
  await expect(page.getByText("MOCK PAYMENT GATEWAY - TEST MODE")).toBeVisible();
  await page.locator(`input[name="webhook"][value="${webhook}"]`).check();
  await page.getByTestId(outcome).click();
  await expect(page).toHaveURL(/\/payment\/return\?/);
}

// Native-style API access: Supabase SDK session + bearer token, optionally stepped up to aal2 with TOTP.
function supabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("run pnpm env:local");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export async function nativeSignIn(email: string) {
  const client = supabase();
  const sentAt = Date.now();
  const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) throw error;
  const { data, error: verifyError } = await client.auth.verifyOtp({ email, token: await latestCode(email, sentAt), type: "email" });
  if (verifyError || !data.session) throw verifyError ?? new Error("no session");
  return { client, token: data.session.access_token };
}

export async function stepUpToAal2(client: SupabaseClient): Promise<string> {
  const { data: factor, error } = await client.auth.mfa.enroll({ factorType: "totp" });
  if (error || !factor) throw error ?? new Error("enroll failed");
  const { data, error: verifyError } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(factor.totp.secret) });
  if (verifyError || !data) throw verifyError ?? new Error("verify failed");
  return data.access_token;
}

export const bearer = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });

// A paid booking that starts now, checked in and out by venue staff over the API (bearer + TOTP): COMPLETED.
export async function completedBooking(page: Page, request: APIRequestContext) {
  const venue = await createQuickVenue({ tables: 1 });
  const customer = await signedInCustomer(page);
  const hold = await holdThroughApi(page, venue, 0, 1);
  await page.goto(`/checkout/${hold.booking_id}`);
  await payOnMockGateway(page, "mock-pay-success");
  await expect(page.getByTestId("payment-title")).toHaveText("Booking confirmed");
  await page.goto(`/bookings/${hold.booking_id}`);
  const pin = (await page.getByTestId("arrival-pin").textContent())!.trim();
  const staff = await createFixtureUser({ venueRole: { venueId: venue.venueId, role: "STAFF" } });
  const session = await nativeSignIn(staff.email);
  const token = await stepUpToAal2(session.client);
  const checkIn = await request.post("/api/v1/partner/check-in", {
    headers: bearer(token, { "idempotency-key": randomUUID() }), data: { venue_id: venue.venueId, public_ref: hold.public_ref, pin }
  });
  expect(checkIn.status()).toBe(200);
  const [row] = await db()`select version from public.bookings where id = ${hold.booking_id}::uuid`;
  const checkOut = await request.post(`/api/v1/partner/bookings/${hold.booking_id}/check-out`, {
    headers: bearer(token, { "idempotency-key": randomUUID() }), data: { expected_version: row!.version }
  });
  expect(checkOut.status()).toBe(200);
  return { venue, customer, hold, staffToken: token };
}
