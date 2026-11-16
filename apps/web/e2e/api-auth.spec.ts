// API permission and session paths exercised the way the native apps call the API: Supabase SDK session + bearer token.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  CAFE_TABLE_1, CAFE_VENUE_ID, LOUNGE_VENUE_ID, bearer, createFixtureUser, createQuickVenue, istSlot, nativeSignIn, nextQuickSlot, stepUpToAal2
} from "./helpers";

test("staff: own venue needs MFA, another venue is 404, and closures are forbidden even at aal2", async ({ request }) => {
  const staff = await createFixtureUser({ venueRole: { venueId: CAFE_VENUE_ID, role: "STAFF" } });
  const { client, token } = await nativeSignIn(staff.email);

  const me = await request.get("/api/v1/me", { headers: bearer(token) });
  expect(me.status()).toBe(200);
  const meBody = await me.json();
  expect(meBody.data.venue_memberships.map((m: { role: string }) => m.role)).toEqual(["STAFF"]);
  expect(meBody.data.mfa_required_for_portal).toBe(true);

  const other = await request.get(`/api/v1/partner/bookings?venue_id=${LOUNGE_VENUE_ID}`, { headers: bearer(token) });
  expect(other.status()).toBe(404);
  const aal1 = await request.get(`/api/v1/partner/bookings?venue_id=${CAFE_VENUE_ID}`, { headers: bearer(token) });
  expect(aal1.status()).toBe(403);
  expect((await aal1.json()).error.code).toBe("REAUTH_REQUIRED");

  const aal2 = await stepUpToAal2(client);
  const own = await request.get(`/api/v1/partner/bookings?venue_id=${CAFE_VENUE_ID}`, { headers: bearer(aal2) });
  expect(own.status()).toBe(200);

  const closure = await request.post(`/api/v1/partner/resources/${CAFE_TABLE_1}/closures`, {
    headers: bearer(aal2, { "idempotency-key": randomUUID() }),
    data: { start_at: istSlot(25, "08:00"), end_at: istSlot(25, "09:00"), reason: "Staff should not be able to do this" }
  });
  expect(closure.status()).toBe(403);
  expect((await closure.json()).error.code).toBe("FORBIDDEN");
});

test("manager: closure succeeds with MFA, replays for the same key and conflicts for a changed body", async ({ request }) => {
  // Its own fictional venue and table, so closures left by earlier runs against the same database cannot overlap.
  const venue = await createQuickVenue({ tables: 1 });
  const table = venue.tableIds[0]!;
  const manager = await createFixtureUser({ venueRole: { venueId: venue.venueId, role: "MANAGER" } });
  const { client } = await nativeSignIn(manager.email);
  const token = await stepUpToAal2(client);
  const key = randomUUID();
  const body = { start_at: istSlot(26, "08:00"), end_at: istSlot(26, "08:30"), reason: `E2E maintenance ${key.slice(0, 6)}` };

  const first = await request.post(`/api/v1/partner/resources/${table}/closures`, { headers: bearer(token, { "idempotency-key": key }), data: body });
  expect(first.status()).toBe(201);
  const replay = await request.post(`/api/v1/partner/resources/${table}/closures`, { headers: bearer(token, { "idempotency-key": key }), data: body });
  expect(replay.status()).toBe(201);
  expect((await replay.json()).data).toEqual((await first.json()).data);
  const changed = await request.post(`/api/v1/partner/resources/${table}/closures`, {
    headers: bearer(token, { "idempotency-key": key }),
    data: { ...body, reason: "different reason" }
  });
  expect(changed.status()).toBe(409);
  expect((await changed.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
});

test("customer: quote and idempotent hold; a second customer gets 409 for the same table and time", async ({ request }) => {
  const [a, b] = [await createFixtureUser(), await createFixtureUser()];
  const [{ token: ta }, { token: tb }] = [await nativeSignIn(a.email), await nativeSignIn(b.email)];
  // Its own fictional venue, so earlier runs against the same (unreset) database cannot have taken the slot.
  const venue = await createQuickVenue({ tables: 1 });
  const slot = { venue_id: venue.venueId, resource_id: venue.tableIds[0], start_at: nextQuickSlot(120), duration_minutes: 60, party_size: 2 };

  const quote = await request.post("/api/v1/quotes", { headers: bearer(ta), data: slot });
  expect(quote.status()).toBe(201);
  const q = (await quote.json()).data;
  const holdBody = { quote_id: q.quote_id, accepted_policy_hash: q.policy_hash, expected_quote_total_paise: q.price_snapshot.total_paise };
  const key = randomUUID();
  const hold = await request.post("/api/v1/booking-holds", { headers: bearer(ta, { "idempotency-key": key }), data: holdBody });
  expect(hold.status()).toBe(201);
  const replay = await request.post("/api/v1/booking-holds", { headers: bearer(ta, { "idempotency-key": key }), data: holdBody });
  expect(replay.headers()["idempotent-replayed"]).toBe("true");
  expect((await replay.json()).data.booking_id).toBe((await hold.json()).data.booking_id);

  const competing = await request.post("/api/v1/quotes", { headers: bearer(tb), data: slot });
  expect(competing.status()).toBe(409);
  expect((await competing.json()).error.code).toBe("SLOT_UNAVAILABLE");

  const noKey = await request.post("/api/v1/booking-holds", { headers: bearer(ta), data: holdBody });
  expect(noKey.status()).toBe(400);
});

test("sessions: ambiguous identity is rejected, sign-out revokes the token, deletion pauses bookings", async ({ request, playwright }) => {
  const user = await createFixtureUser();
  const { token } = await nativeSignIn(user.email);

  const ambiguous = await request.get("/api/v1/me", { headers: { ...bearer(token), cookie: "sb-localhost-auth-token=abc" } });
  expect(ambiguous.status()).toBe(400);

  const deletion = await request.post("/api/v1/privacy-requests", { headers: bearer(token), data: { kind: "DELETE" } });
  expect(deletion.status()).toBe(202);
  const quote = await request.post("/api/v1/quotes", {
    headers: bearer(token),
    data: { venue_id: CAFE_VENUE_ID, resource_id: CAFE_TABLE_1, start_at: istSlot(27, "12:00"), duration_minutes: 60, party_size: 1 }
  });
  expect(quote.status()).toBe(403);
  expect((await quote.json()).error.code).toBe("ACCOUNT_DELETION_PENDING");

  const signOut = await request.post("/api/v1/auth/sign-out", { headers: bearer(token) });
  expect(signOut.status()).toBe(204);
  const fresh = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
  const after = await fresh.get("/api/v1/me", { headers: bearer(token) });
  expect(after.status()).toBe(401);
  await fresh.dispose();
});

test("anonymous callers get 401 on protected routes and cannot use another origin with cookies", async ({ request }) => {
  expect((await request.get("/api/v1/me")).status()).toBe(401);
  const forged = await request.post("/api/v1/me/terms", {
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    data: { terms_version: "x", privacy_version: "y" }
  });
  expect(forged.status()).toBe(401);
});
