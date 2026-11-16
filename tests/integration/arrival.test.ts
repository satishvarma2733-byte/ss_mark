// M3.5 staff arrival on real PostgreSQL (docs/07 s.4-5; docs/08 T12/T13 arrival part, T14; AC-07).
// A 5-minute grid with no lead time lets a booking start within minutes, so the check-in window is open now. Venues
// open 04:00-03:55 (overnight) so these tests do not fail late in the evening.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser, customerBooking, staffArrivals, staffCheckIn, staffCheckOut, staffMarkReady, type Sql
} from "@simply-sit/db";
import { arrivalCodes } from "@simply-sit/domain";
import { applyPayment, startCheckout } from "@simply-sit/payments";
import {
  claimsFor, createUser, createVenue, expectDomainError, grantVenueRole, holdTable, nextGridSlot, openDb, paymentServices,
  type TestUser, type TestVenue
} from "./helpers";

let sql: Sql;
let venue: TestVenue;
let otherVenue: TestVenue;
let staff: TestUser;
let otherStaff: TestUser;
let manager: TestUser;

const quickPolicy = { increment_minutes: 5, lead_minutes: 0 };

beforeAll(async () => {
  sql = openDb(20);
  const tables = Array.from({ length: 12 }, () => ({ capacity: 4, hourlyPaise: 30000 }));
  venue = await createVenue(sql, { tables, policy: quickPolicy, hours: { weekdays: [0, 1, 2, 3, 4, 5, 6], opens: "04:00", closes: "03:55" } });
  otherVenue = await createVenue(sql, { policy: quickPolicy, hours: { weekdays: [0, 1, 2, 3, 4, 5, 6], opens: "04:00", closes: "03:55" } });
  [staff, otherStaff, manager] = [await createUser(sql), await createUser(sql), await createUser(sql)];
  await grantVenueRole(sql, venue.venueId, staff, "STAFF");
  await grantVenueRole(sql, otherVenue.venueId, otherStaff, "STAFF");
  await grantVenueRole(sql, venue.venueId, manager, "MANAGER");
});
afterAll(async () => {
  await sql.end();
});

const staffClaims = (user: TestUser = staff) => claimsFor(user, { aal: "aal2" });
let nextTable = 0;

// A confirmed booking on its own table starting within the next few minutes (or `minutesAhead` later).
async function confirmedBooking(opts: { minutesAhead?: number; v?: TestVenue; table?: number } = {}) {
  const v = opts.v ?? venue;
  const customer = await createUser(sql);
  const table = opts.table ?? (nextTable++ % v.tableIds.length);
  const hold = await holdTable(sql, customer, v, nextGridSlot(5, opts.minutesAhead ?? 1), { table });
  const services = paymentServices(sql);
  const { order } = await startCheckout(services, claimsFor(customer), { bookingId: hold.booking_id, expectedVersion: hold.version }, crypto.randomUUID());
  const payment = await services.gateway.simulatePayment(order.provider_order_id!, "capture");
  const outcome = await applyPayment(services, order, payment, "VERIFY");
  expect(outcome.outcome).toBe("CONFIRMED");
  const codes = arrivalCodes(services.arrivalSecret, hold.booking_id);
  return { customer, hold, codes, resourceId: v.tableIds[table]! };
}

const checkIn = (user: TestUser, input: { qr_token?: string; public_ref?: string; pin?: string }, v: TestVenue = venue, aal: "aal1" | "aal2" = "aal2") =>
  asUser(sql, claimsFor(user, { aal }), (tx) =>
    staffCheckIn(tx, { venue_id: v.venueId, qr_token: input.qr_token ?? null, public_ref: input.public_ref ?? null, pin: input.pin ?? null }));

describe("check-in (AC-07)", () => {
  it("checks in once with reference + PIN, then reports the existing check-in on repeat", async () => {
    const { hold, codes, resourceId } = await confirmedBooking();
    const first = await checkIn(staff, { public_ref: hold.public_ref, pin: codes.pin });
    expect(first).toMatchObject({ outcome: "CHECKED_IN", status: "CHECKED_IN", public_ref: hold.public_ref });
    const again = await checkIn(staff, { public_ref: hold.public_ref, pin: codes.pin });
    expect(again).toMatchObject({ outcome: "ALREADY_CHECKED_IN" });
    const [table] = await sql`select operational_state from public.resources where id = ${resourceId}::uuid`;
    expect(table).toEqual({ operational_state: "OCCUPIED" });
    const audit = await sql`select action from public.audit_events where entity_id = ${hold.booking_id}::uuid`;
    expect(audit.map((a) => a.action)).toEqual(["booking.check_in"]);
  });

  it("checks in with the QR token", async () => {
    const { codes } = await confirmedBooking();
    expect(await checkIn(staff, { qr_token: codes.qrToken })).toMatchObject({ outcome: "CHECKED_IN" });
  });

  it("rejects a wrong PIN, another venue's code and an unknown token with the same generic outcome, and logs them", async () => {
    const { hold, codes } = await confirmedBooking();
    const wrongPin = codes.pin === "000000" ? "111111" : "000000";
    expect(await checkIn(staff, { public_ref: hold.public_ref, pin: wrongPin })).toEqual({ outcome: "INVALID" });
    expect(await checkIn(otherStaff, { qr_token: codes.qrToken }, otherVenue)).toEqual({ outcome: "INVALID" });
    expect(await checkIn(staff, { qr_token: "A".repeat(43) })).toEqual({ outcome: "INVALID" });
    const [failed] = await sql`select count(*)::int as n from public.arrival_attempts where outcome = 'FAILED'
                               and staff_profile_id in (${staff.profileId}::uuid, ${otherStaff.profileId}::uuid)`;
    expect(failed!.n).toBeGreaterThanOrEqual(3);
    const booking = await sql`select status from public.bookings where id = ${hold.booking_id}::uuid`;
    expect(booking).toEqual([{ status: "CONFIRMED" }]);
  });

  it("requires an assigned, MFA-verified staff member", async () => {
    const { codes } = await confirmedBooking();
    await expectDomainError(checkIn(staff, { qr_token: codes.qrToken }, venue, "aal1"), "REAUTH_REQUIRED");
    await expectDomainError(checkIn(otherStaff, { qr_token: codes.qrToken }, venue), "NOT_FOUND");
    const customer = await createUser(sql);
    await expectDomainError(checkIn(customer, { qr_token: codes.qrToken }, venue), "NOT_FOUND");
  });

  it("refuses check-in before the window opens", async () => {
    const { codes } = await confirmedBooking({ minutesAhead: 120 });
    const details = await expectDomainError(checkIn(staff, { qr_token: codes.qrToken }), "CHECK_IN_NOT_OPEN");
    expect(details).toMatchObject({ reason: "too_early" });
  });

  it("blocks a table that is not ready, and early arrival into time another claim still holds", async () => {
    const notReady = await confirmedBooking();
    await sql`update public.resources set operational_state = 'CLEANING' where id = ${notReady.resourceId}::uuid`;
    await expectDomainError(checkIn(staff, { qr_token: notReady.codes.qrToken }), "TABLE_NOT_READY");
    await sql`update public.resources set operational_state = 'READY' where id = ${notReady.resourceId}::uuid`;

    const early = await confirmedBooking({ minutesAhead: 6 });
    const [b] = await sql`select start_at from public.bookings where id = ${early.hold.booking_id}::uuid`;
    // Fixture: a closure covering the minutes before this booking starts (as an earlier guest's sold time would).
    await sql`insert into public.inventory_claims (venue_id, resource_id, kind, blocked_range, reason)
              values (${venue.venueId}::uuid, ${early.resourceId}::uuid, 'CLOSURE',
                      tstzrange(clock_timestamp() - interval '1 minute', ${b!.start_at as Date}, '[)'), 'Earlier use (test)')`;
    const details = await expectDomainError(checkIn(staff, { qr_token: early.codes.qrToken }), "CHECK_IN_NOT_OPEN");
    expect(details).toMatchObject({ reason: "previous_booking" });
  });

  it("rate limits repeated failed codes per staff member", async () => {
    const guesser = await createUser(sql);
    await grantVenueRole(sql, venue.venueId, guesser, "STAFF");
    for (let i = 0; i < 10; i += 1) {
      expect(await checkIn(guesser, { public_ref: "SS-AAAAAAAAAA", pin: String(100000 + i) })).toEqual({ outcome: "INVALID" });
    }
    await expectDomainError(checkIn(guesser, { public_ref: "SS-AAAAAAAAAA", pin: "123456" }), "RATE_LIMITED");
  });
});

describe("check-out and table readiness (T13)", () => {
  it("completes the booking, revokes its codes, sets CLEANING, and only staff readiness makes the table READY", async () => {
    const { hold, codes, resourceId, customer } = await confirmedBooking();
    const checkedIn = await checkIn(staff, { qr_token: codes.qrToken });
    const version = (checkedIn as { version: number }).version;

    await expectDomainError(
      asUser(sql, staffClaims(), (tx) => staffMarkReady(tx, resourceId, 1)),
      "STALE_VERSION"
    );
    const [occupied] = await sql`select version from public.resources where id = ${resourceId}::uuid`;
    await expectDomainError(asUser(sql, staffClaims(), (tx) => staffMarkReady(tx, resourceId, occupied!.version as number)), "INVALID_TRANSITION");

    await expectDomainError(asUser(sql, staffClaims(), (tx) => staffCheckOut(tx, hold.booking_id, version + 9)), "STALE_VERSION");
    await expectDomainError(asUser(sql, staffClaims(otherStaff), (tx) => staffCheckOut(tx, hold.booking_id, version)), "NOT_FOUND");
    const done = await asUser(sql, staffClaims(), (tx) => staffCheckOut(tx, hold.booking_id, version));
    expect(done).toMatchObject({ status: "COMPLETED", already: false });
    expect(await asUser(sql, staffClaims(), (tx) => staffCheckOut(tx, hold.booking_id, version))).toMatchObject({ already: true });

    const [row] = await sql`select checkin_token_hash, checkin_pin_hash from public.bookings where id = ${hold.booking_id}::uuid`;
    expect(row).toEqual({ checkin_token_hash: null, checkin_pin_hash: null });
    expect(await checkIn(staff, { qr_token: codes.qrToken })).toEqual({ outcome: "INVALID" });
    const [claim] = await sql`select active from public.inventory_claims where booking_id = ${hold.booking_id}::uuid`;
    expect(claim).toEqual({ active: true }); // early departure never resells the paid interval

    const [cleaning] = await sql`select operational_state, version from public.resources where id = ${resourceId}::uuid`;
    expect(cleaning!.operational_state).toBe("CLEANING");
    const ready = await asUser(sql, staffClaims(), (tx) => staffMarkReady(tx, resourceId, cleaning!.version as number));
    expect(ready).toMatchObject({ operational_state: "READY", already: false });

    const view = await asUser(sql, claimsFor(customer), (tx) => customerBooking(tx, hold.booking_id));
    expect(view).toMatchObject({ status: "COMPLETED" });
  });
});

describe("what staff can see (T14, review R1)", () => {
  it("gives staff a minimal arrivals list without customer identity or money", async () => {
    const { hold } = await confirmedBooking();
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const list = await asUser(sql, staffClaims(), (tx) => staffArrivals(tx, venue.venueId, today));
    const row = (list.bookings as Record<string, unknown>[]).find((b) => b.booking_id === hold.booking_id);
    expect(row).toBeDefined();
    expect(Object.keys(row!).sort()).toEqual([
      "booking_id", "checked_in_at", "checked_out_at", "end_at", "party_size", "public_ref", "resource_id", "start_at", "status",
      "table_label", "version"
    ]);
    await expectDomainError(asUser(sql, claimsFor(staff), (tx) => staffArrivals(tx, venue.venueId, today)), "REAUTH_REQUIRED");
    await expectDomainError(asUser(sql, staffClaims(otherStaff), (tx) => staffArrivals(tx, venue.venueId, today)), "NOT_FOUND");
  });

  it("does not let staff read booking rows (prices, customer IDs) directly; managers need MFA", async () => {
    const { hold } = await confirmedBooking();
    const read = (user: TestUser, aal: "aal1" | "aal2") =>
      asUser(sql, claimsFor(user, { aal }), (tx) => tx`select price_snapshot from public.bookings where id = ${hold.booking_id}::uuid`);
    expect(await read(staff, "aal1")).toHaveLength(0);
    expect(await read(staff, "aal2")).toHaveLength(0);
    expect(await read(manager, "aal1")).toHaveLength(0);
    expect(await read(manager, "aal2")).toHaveLength(1);
  });
});

describe("arrival under concurrency (review F6 and coverage)", () => {
  it("checks in once when two staff devices submit the same code together", async () => {
    const { codes, hold } = await confirmedBooking();
    const [a, b] = await Promise.all([checkIn(staff, { qr_token: codes.qrToken }), checkIn(manager, { qr_token: codes.qrToken })]);
    expect([a.outcome, b.outcome].sort()).toEqual(["ALREADY_CHECKED_IN", "CHECKED_IN"]);
    const [events] = await sql`select count(*)::int as n from public.booking_events where booking_id = ${hold.booking_id}::uuid and event_type = 'CHECKED_IN'`;
    expect(events!.n).toBe(1);
    const [success] = await sql`select count(*)::int as n from public.arrival_attempts where booking_id = ${hold.booking_id}::uuid and outcome = 'SUCCESS'`;
    expect(success!.n).toBe(1);
  });

  it("holds the failed-code limit under parallel guesses", async () => {
    const guesser = await createUser(sql);
    await grantVenueRole(sql, venue.venueId, guesser, "STAFF");
    const results = await Promise.allSettled(
      Array.from({ length: 14 }, (_, i) => checkIn(guesser, { public_ref: "SS-AAAAAAAAAA", pin: String(200000 + i) })));
    const invalid = results.filter((r) => r.status === "fulfilled").length;
    const limited = results.filter((r) => r.status === "rejected" && (r.reason as { code?: string }).code === "RATE_LIMITED").length;
    expect([invalid, limited]).toEqual([10, 4]);
    const [logged] = await sql`select count(*)::int as n from public.arrival_attempts where staff_profile_id = ${guesser.profileId}::uuid`;
    expect(logged!.n).toBe(10);
  });
});
