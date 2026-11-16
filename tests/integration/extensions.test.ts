// M4.2 extensions on real PostgreSQL with the local mock gateway (docs/03 extension deadlines; docs/07 s.6, s.8; docs/08 T11).
// Staff decide within request + 5 min; approval gives decision + 5 min to hold; a hold lasts min(hold + 5 min, original
// end). Only a timely exact capture moves the end; anything else is refund liability and the original booking survives.
// The test venue opens 04:00-03:55 (overnight) so bookings that start now can be extended past midnight.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser, asWorker, beginExtensionCheckout, cancelExtension, customerBooking, decideExtension, expireDueHolds, holdExtension,
  requestExtension, staffCheckIn, staffCheckOut, staffExtensionRequests, type Sql
} from "@simply-sit/db";
import { arrivalCodes } from "@simply-sit/domain";
import { applyPayment, ensureProviderOrder, startCheckout } from "@simply-sit/payments";
import {
  claimsFor, createUser, createVenue, expectDomainError, grantVenueRole, holdTable, nextGridSlot, openDb, paymentServices,
  type TestUser, type TestVenue
} from "./helpers";

let sql: Sql;
let venue: TestVenue;
let otherVenue: TestVenue;
let staff: TestUser;
let otherStaff: TestUser;

beforeAll(async () => {
  sql = openDb(20);
  const hours = { weekdays: [0, 1, 2, 3, 4, 5, 6], opens: "04:00", closes: "03:55" };
  venue = await createVenue(sql, {
    tables: Array.from({ length: 40 }, () => ({ capacity: 4, hourlyPaise: 30000 })),
    policy: { increment_minutes: 5, lead_minutes: 0 }, hours
  });
  otherVenue = await createVenue(sql, { policy: { increment_minutes: 5, lead_minutes: 0 }, hours });
  [staff, otherStaff] = [await createUser(sql), await createUser(sql)];
  await grantVenueRole(sql, venue.venueId, staff, "STAFF");
  await grantVenueRole(sql, otherVenue.venueId, otherStaff, "STAFF");
});
afterAll(async () => {
  await sql.end();
});

let nextTable = 0;
const s = () => paymentServices(sql);
const staffAs = (user: TestUser = staff) => <T>(work: Parameters<typeof asUser<T>>[2]) => asUser(sql, claimsFor(user, { aal: "aal2" }), work);
const bookingRow = (id: string) =>
  sql`select status, end_at, version from public.bookings where id = ${id}::uuid`.then((r) => r[0] as { status: string; end_at: Date; version: number });
const claimUpper = (id: string) =>
  sql`select upper(blocked_range) as upper from public.inventory_claims where booking_id = ${id}::uuid and kind = 'BOOKING'`
    .then((r) => (r[0]!.upper as Date).toISOString());
const plusMinutes = (iso: string | Date, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

// A paid booking on its own table that has started (or starts within minutes) and is checked in.
async function checkedInBooking(opts: { table?: number; checkIn?: boolean } = {}) {
  const customer = await createUser(sql);
  const table = opts.table ?? nextTable++ % venue.tableIds.length;
  const start = nextGridSlot(5, 1);
  const hold = await holdTable(sql, customer, venue, start, { table });
  const { order } = await startCheckout(s(), claimsFor(customer), { bookingId: hold.booking_id, expectedVersion: hold.version }, crypto.randomUUID());
  await applyPayment(s(), order, await s().gateway.simulatePayment(order.provider_order_id!, "capture"), "VERIFY");
  if (opts.checkIn !== false) {
    const codes = arrivalCodes(s().arrivalSecret, hold.booking_id);
    const result = await staffAs()((tx) => staffCheckIn(tx, { venue_id: venue.venueId, qr_token: codes.qrToken, public_ref: null, pin: null }));
    expect(result).toMatchObject({ outcome: "CHECKED_IN" });
  }
  const row = await bookingRow(hold.booking_id);
  return { customer, bookingId: hold.booking_id, table, start, end: row.end_at.toISOString(), version: row.version };
}

const asCustomer = (user: TestUser) => <T>(work: Parameters<typeof asUser<T>>[2]) => asUser(sql, claimsFor(user), work);
type Ext = { extension_id: string; status: string; version: number; amount_paise: number; requested_end_at: string; hold_expires_at: string | null;
             request_expires_at: string; approval_expires_at: string | null };

async function approvedExtension(minutes = 30) {
  const b = await checkedInBooking();
  const ext = (await asCustomer(b.customer)((tx) => requestExtension(tx, b.bookingId, minutes, b.version))) as Ext;
  const approved = (await staffAs()((tx) => decideExtension(tx, ext.extension_id, { decision: "APPROVE", expected_version: ext.version }))) as Ext;
  return { ...b, ext: approved };
}

async function heldExtension(minutes = 30) {
  const a = await approvedExtension(minutes);
  const held = (await asCustomer(a.customer)((tx) => holdExtension(tx, a.ext.extension_id, a.ext.amount_paise, a.ext.version))) as Ext;
  return { ...a, ext: held };
}

describe("request (C11)", () => {
  it("needs the customer's own checked-in booking, whole increments and the maximum duration; one open request", async () => {
    const notIn = await checkedInBooking({ checkIn: false });
    await expectDomainError(asCustomer(notIn.customer)((tx) => requestExtension(tx, notIn.bookingId, 30, notIn.version)), "INVALID_TRANSITION");

    const b = await checkedInBooking();
    const stranger = await createUser(sql);
    await expectDomainError(asCustomer(stranger)((tx) => requestExtension(tx, b.bookingId, 30, b.version)), "NOT_FOUND");
    await expectDomainError(asCustomer(b.customer)((tx) => requestExtension(tx, b.bookingId, 7, b.version)), "VALIDATION_FAILED");
    const tooLong = await expectDomainError(asCustomer(b.customer)((tx) => requestExtension(tx, b.bookingId, 185, b.version)), "VALIDATION_FAILED");
    expect(tooLong).toMatchObject({ reason: "max_duration", maximum_minutes: 240 });

    const ext = (await asCustomer(b.customer)((tx) => requestExtension(tx, b.bookingId, 30, b.version))) as Ext;
    expect(ext).toMatchObject({ status: "REQUESTED", amount_paise: 15000, requested_end_at: expect.any(String) });
    expect(Date.parse(ext.request_expires_at) - Date.now()).toBeLessThanOrEqual(5 * 60_000 + 5_000);
    // A request reserves nothing: the claim still ends at the original end + buffer.
    expect(await claimUpper(b.bookingId)).toBe(plusMinutes(b.end, 10));
    const again = await expectDomainError(asCustomer(b.customer)((tx) => requestExtension(tx, b.bookingId, 30, b.version)), "INVALID_TRANSITION");
    expect(again).toEqual({ reason: "extension_open" });
    const desk = (await staffAs()((tx) => staffExtensionRequests(tx, venue.venueId))) as { extension_id: string; feasible: boolean }[];
    expect(desk).toContainEqual(expect.objectContaining({ extension_id: ext.extension_id, feasible: true }));
    expect(JSON.stringify(desk)).not.toMatch(/amount_paise/);
  });
});

describe("staff decision (P06)", () => {
  it("only the venue's TOTP-verified staff decide, within five minutes, and only while it still looks possible", async () => {
    const b = await checkedInBooking();
    const ext = (await asCustomer(b.customer)((tx) => requestExtension(tx, b.bookingId, 30, b.version))) as Ext;
    await expectDomainError(asUser(sql, claimsFor(staff, { aal: "aal1" }), (tx) =>
      decideExtension(tx, ext.extension_id, { decision: "APPROVE", expected_version: ext.version })), "REAUTH_REQUIRED");
    await expectDomainError(staffAs(otherStaff)((tx) => decideExtension(tx, ext.extension_id, { decision: "APPROVE", expected_version: ext.version })), "NOT_FOUND");
    await expectDomainError(asCustomer(b.customer)((tx) => decideExtension(tx, ext.extension_id, { decision: "APPROVE", expected_version: ext.version })), "NOT_FOUND");

    // Someone else books the table right after this booking's cleaning buffer: approval is refused.
    const next = await createUser(sql);
    await holdTable(sql, next, venue, plusMinutes(b.end, 10), { table: b.table });
    const refused = await expectDomainError(staffAs()((tx) => decideExtension(tx, ext.extension_id, { decision: "APPROVE", expected_version: ext.version })), "SLOT_UNAVAILABLE");
    expect(refused).toEqual({ reason: "next_booking" });
    const declined = (await staffAs()((tx) => decideExtension(tx, ext.extension_id, { decision: "DECLINE", reason: "Next guest arriving", expected_version: ext.version }))) as Ext & { decline_reason: string };
    expect(declined).toMatchObject({ status: "DECLINED", decline_reason: "Next guest arriving" });
    const [job] = await sql`select kind from public.outbox_jobs where business_key = ${`extension:${ext.extension_id}:decided`}`;
    expect(job).toEqual({ kind: "extension.notify" });
  });

  it("refuses a decision after the five-minute window (the request expires)", async () => {
    const b = await checkedInBooking();
    const ext = (await asCustomer(b.customer)((tx) => requestExtension(tx, b.bookingId, 30, b.version))) as Ext;
    await sql`update public.extension_requests set request_expires_at = clock_timestamp() - interval '1 second' where id = ${ext.extension_id}::uuid`;
    await expectDomainError(staffAs()((tx) => decideExtension(tx, ext.extension_id, { decision: "APPROVE", expected_version: ext.version })), "EXTENSION_EXPIRED");
    // The refusal rolls back with its transaction; the worker's sweep records the expiry.
    await asWorker(sql, (tx) => expireDueHolds(tx, 100));
    const [row] = await sql`select status from public.extension_requests where id = ${ext.extension_id}::uuid`;
    expect(row).toEqual({ status: "EXPIRED" });
  });
});

describe("atomic hold (T11)", () => {
  it("re-prices, widens the booking's own claim and blocks the next booking; the hold ends by the original end", async () => {
    const a = await approvedExtension();
    expect(Date.parse(a.ext.approval_expires_at!) - Date.now()).toBeLessThanOrEqual(5 * 60_000 + 5_000);
    const changed = await expectDomainError(asCustomer(a.customer)((tx) => holdExtension(tx, a.ext.extension_id, 1, a.ext.version)), "QUOTE_CHANGED");
    expect(changed).toEqual({ amount_paise: 15000 });
    const held = (await asCustomer(a.customer)((tx) => holdExtension(tx, a.ext.extension_id, 15000, a.ext.version))) as Ext;
    expect(held.status).toBe("HELD");
    expect(Date.parse(held.hold_expires_at!)).toBeLessThanOrEqual(Math.min(Date.now() + 5 * 60_000 + 5_000, Date.parse(a.end)));
    expect(await claimUpper(a.bookingId)).toBe(plusMinutes(held.requested_end_at, 10));
    const next = await createUser(sql);
    await expectDomainError(holdTable(sql, next, venue, plusMinutes(a.end, 10), { table: a.table }), "SLOT_UNAVAILABLE");
    // The booking itself is unchanged until payment.
    expect((await bookingRow(a.bookingId)).end_at.toISOString()).toBe(a.end);
  });

  it("lets exactly one of an extension hold and a competing booking win the same time", async () => {
    for (let round = 0; round < 3; round += 1) {
      const a = await approvedExtension();
      const rival = await createUser(sql);
      const [ext, other] = await Promise.allSettled([
        asCustomer(a.customer)((tx) => holdExtension(tx, a.ext.extension_id, a.ext.amount_paise, a.ext.version)),
        holdTable(sql, rival, venue, plusMinutes(a.end, 10), { table: a.table })
      ]);
      expect([ext.status, other.status].filter((x) => x === "fulfilled")).toHaveLength(1);
      const active = await sql`select count(*)::int as n from public.inventory_claims where resource_id = ${venue.tableIds[a.table]!}::uuid and active
                               and blocked_range && tstzrange(${a.end}::timestamptz, ${plusMinutes(a.end, 40)}::timestamptz)`;
      expect(active[0]!.n).toBe(1);
      expect((await bookingRow(a.bookingId)).status).toBe("CHECKED_IN");
    }
  });

  it("does not let earlier deadlines shorten a created hold, and caps the hold at the original end", async () => {
    const h = await heldExtension();
    await sql`update public.extension_requests set request_expires_at = clock_timestamp() - interval '1 minute',
              approval_expires_at = clock_timestamp() - interval '1 second' where id = ${h.ext.extension_id}::uuid`;
    await asWorker(sql, (tx) => expireDueHolds(tx, 100));
    expect((await sql`select status from public.extension_requests where id = ${h.ext.extension_id}::uuid`)[0]).toEqual({ status: "HELD" });

    // Test-only clock travel: the booking now ends in two minutes; a new hold is capped at that end.
    const a = await approvedExtension();
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update public.bookings set start_at = date_trunc('minute', clock_timestamp()) - interval '58 minutes',
               end_at = date_trunc('minute', clock_timestamp()) + interval '2 minutes' where id = ${a.bookingId}::uuid`;
      await tx`update public.extension_requests set original_end_at = (select end_at from public.bookings where id = ${a.bookingId}::uuid),
               requested_end_at = (select end_at from public.bookings where id = ${a.bookingId}::uuid) + interval '30 minutes'
               where id = ${a.ext.extension_id}::uuid`;
      await tx`update public.inventory_claims set blocked_range = tstzrange(lower(blocked_range),
               (select end_at from public.bookings where id = ${a.bookingId}::uuid) + interval '10 minutes')
               where booking_id = ${a.bookingId}::uuid`;
    });
    const held = (await asCustomer(a.customer)((tx) => holdExtension(tx, a.ext.extension_id, a.ext.amount_paise, a.ext.version))) as Ext;
    const end = (await bookingRow(a.bookingId)).end_at.getTime();
    expect(Date.parse(held.hold_expires_at!)).toBe(end);
  });
});

describe("payment (T11, docs/07 s.6)", () => {
  async function extensionOrder(h: Awaited<ReturnType<typeof heldExtension>>) {
    const begun = await asCustomer(h.customer)((tx) =>
      beginExtensionCheckout(tx, { extension_id: h.ext.extension_id, expected_version: h.ext.version, provider: "mock", environment: "TEST" }));
    expect(begun).toMatchObject({ extension_id: h.ext.extension_id, expected_amount_paise: 15000, created: true });
    return ensureProviderOrder(s(), begun);
  }

  it("applies a timely exact capture once: the end moves, one allocation, balanced journals; a second capture is refunded", async () => {
    const h = await heldExtension();
    const order = await extensionOrder(h);
    const payment = await s().gateway.simulatePayment(order.provider_order_id!, "capture");
    expect(await applyPayment(s(), order, payment, "VERIFY")).toMatchObject({ outcome: "EXTENDED", extension_status: "APPLIED" });
    expect(await applyPayment(s(), order, payment, "WEBHOOK")).toMatchObject({ outcome: "RECORDED", allocation_state: "EXTENSION" });
    expect((await bookingRow(h.bookingId)).end_at.toISOString()).toBe(plusMinutes(h.ext.requested_end_at, 0));
    expect(await claimUpper(h.bookingId)).toBe(plusMinutes(h.ext.requested_end_at, 10));
    const journals = await sql`select kind from public.ledger_journals where booking_id = ${h.bookingId}::uuid order by created_at`;
    expect(journals.map((j) => j.kind)).toEqual(["CAPTURE_ALLOCATED_BOOKING", "CAPTURE_ALLOCATED_EXTENSION"]);

    const second = await s().gateway.simulatePayment(order.provider_order_id!, "capture");
    expect(await applyPayment(s(), order, second, "RECONCILE")).toMatchObject({ outcome: "REFUND_DUE" });
    const [refund] = await sql`select reason_code, amount_paise from public.refunds where booking_id = ${h.bookingId}::uuid`;
    expect(refund).toMatchObject({ reason_code: "DUPLICATE_CAPTURE", amount_paise: 15000 });
    const seen = await asCustomer(h.customer)((tx) => customerBooking(tx, h.bookingId));
    expect(seen).toMatchObject({ extension: { status: "APPLIED" }, extensions_applied: [expect.objectContaining({ amount_paise: 15000 })] });
    // The booking's own payment summary is not replaced by the extension order.
    expect(seen.payment).toMatchObject({ allocation: "ALLOCATED" });
  });

  it("never extends after the hold deadline: the capture is refund liability, the end and claim go back", async () => {
    const h = await heldExtension();
    const order = await extensionOrder(h);
    await sql`update public.extension_requests set hold_expires_at = clock_timestamp() - interval '1 second' where id = ${h.ext.extension_id}::uuid`;
    const late = await applyPayment(s(), order, await s().gateway.simulatePayment(order.provider_order_id!, "capture"), "WEBHOOK");
    expect(late).toMatchObject({ outcome: "REFUND_DUE", extension_status: "EXPIRED" });
    expect((await bookingRow(h.bookingId)).end_at.toISOString()).toBe(h.end);
    expect(await claimUpper(h.bookingId)).toBe(plusMinutes(h.end, 10));
    const [refund] = await sql`select reason_code from public.refunds where booking_id = ${h.bookingId}::uuid`;
    expect(refund).toEqual({ reason_code: "LATE_CAPTURE" });
    // The freed time is bookable again.
    const next = await createUser(sql);
    expect((await holdTable(sql, next, venue, plusMinutes(h.end, 10), { table: h.table })).status).toBe("HOLD");
  });

  it("cancelling, the worker's expiry sweep and check-out all release the widened time", async () => {
    const cancelled = await heldExtension();
    expect(await asCustomer(cancelled.customer)((tx) => cancelExtension(tx, cancelled.ext.extension_id))).toMatchObject({ status: "CANCELLED" });
    expect(await claimUpper(cancelled.bookingId)).toBe(plusMinutes(cancelled.end, 10));

    const swept = await heldExtension();
    await sql`update public.extension_requests set hold_expires_at = clock_timestamp() - interval '1 second' where id = ${swept.ext.extension_id}::uuid`;
    await asWorker(sql, (tx) => expireDueHolds(tx, 100));
    expect((await sql`select status from public.extension_requests where id = ${swept.ext.extension_id}::uuid`)[0]).toEqual({ status: "EXPIRED" });
    expect(await claimUpper(swept.bookingId)).toBe(plusMinutes(swept.end, 10));

    const out = await heldExtension();
    const v = (await bookingRow(out.bookingId)).version;
    await staffAs()((tx) => staffCheckOut(tx, out.bookingId, v));
    expect((await sql`select status, end_reason from public.extension_requests where id = ${out.ext.extension_id}::uuid`)[0])
      .toEqual({ status: "CANCELLED", end_reason: "CHECKED_OUT" });
    expect(await claimUpper(out.bookingId)).toBe(plusMinutes(out.end, 10));
  });
});
