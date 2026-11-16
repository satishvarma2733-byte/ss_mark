// M4.1 cancellation and refund of confirmed bookings on real PostgreSQL with the local mock gateway
// (docs/07 s.3-5, s.7; docs/08 T09/T10). Refunds come from the accepted policy snapshot and the BOOKING-allocated capture,
// evaluated at the database clock; CANCELLED never means "refunded" until the provider refund is PROCESSED.
// Test venue policy (helpers.createVenue): cutoff 120 minutes, early refund 100%, late refund 0%.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser, asWorker, cancelBooking, cancelPreview, customerBooking, jobNotifyBooking, serviceCancelBooking, staffCheckIn, type Sql
} from "@simply-sit/db";
import { arrivalCodes } from "@simply-sit/domain";
import { applyPayment, observeOrderPayments, startCheckout, submitRefund } from "@simply-sit/payments";
import {
  claimsFor, createUser, createVenue, expectDomainError, grantPlatformRole, grantVenueRole, holdTable, istSlot, lateWindowSlot, nextGridSlot, openDb,
  paymentServices, type TestUser, type TestVenue
} from "./helpers";

let sql: Sql;
let venue: TestVenue;
let staff: TestUser;
let manager: TestUser;
let support: TestUser;
let outsider: TestUser;

// 5-minute grid with no lead time, so a booking can start within the late window (or within minutes, for check-in).
const quickPolicy = { increment_minutes: 5, lead_minutes: 0 };
const services = () => paymentServices(sql);

beforeAll(async () => {
  sql = openDb(20);
  const tables = Array.from({ length: 16 }, () => ({ capacity: 4, hourlyPaise: 36000 }));
  venue = await createVenue(sql, { tables, policy: quickPolicy, hours: { weekdays: [0, 1, 2, 3, 4, 5, 6], opens: "04:00", closes: "03:55" } });
  [staff, manager, support, outsider] = [await createUser(sql), await createUser(sql), await createUser(sql), await createUser(sql)];
  await grantVenueRole(sql, venue.venueId, staff, "STAFF");
  await grantVenueRole(sql, venue.venueId, manager, "MANAGER");
  await grantPlatformRole(sql, support, "SUPPORT");
});
afterAll(async () => {
  await sql.end();
});

let nextTable = 0;
let nextDay = 1;

// A confirmed booking on its own table: `early` starts days ahead (outside the cutoff), `late` within the next hour.
async function confirmedBooking(when: "early" | "late" | "soon" = "early", opts: { duplicateCapture?: boolean } = {}) {
  const customer = await createUser(sql);
  const table = nextTable++ % venue.tableIds.length;
  const startAt = when === "early" ? istSlot((nextDay++ % 20) + 2, "10:00") : when === "late" ? lateWindowSlot() : nextGridSlot(5, 1);
  const hold = await holdTable(sql, customer, venue, startAt, { table });
  const s = services();
  const { order } = await startCheckout(s, claimsFor(customer), { bookingId: hold.booking_id, expectedVersion: hold.version }, crypto.randomUUID());
  const payment = await s.gateway.simulatePayment(order.provider_order_id!, "capture");
  expect((await applyPayment(s, order, payment, "VERIFY")).outcome).toBe("CONFIRMED");
  if (opts.duplicateCapture) {
    await s.gateway.simulatePayment(order.provider_order_id!, "capture");
    await observeOrderPayments(s, order, "RECONCILE");
  }
  const booking = await asUser(sql, claimsFor(customer), (tx) => customerBooking(tx, hold.booking_id));
  return { customer, hold, booking, order, resourceId: venue.tableIds[table]!, startAt };
}

const preview = (user: TestUser, bookingId: string) => asUser(sql, claimsFor(user), (tx) => cancelPreview(tx, bookingId));
const cancel = (user: TestUser, bookingId: string, version: number, refund: number, reason: string | null = "CHANGE_OF_PLANS") =>
  asUser(sql, claimsFor(user), (tx) =>
    cancelBooking(tx, { booking_id: bookingId, reason_code: reason, expected_version: version, expected_refund_paise: refund }));
const serviceCancel = (user: TestUser, bookingId: string, version: number, aal: "aal1" | "aal2" = "aal2", reasonCode = "TABLE_UNAVAILABLE") =>
  asUser(sql, claimsFor(user, { aal }), (tx) =>
    serviceCancelBooking(tx, { booking_id: bookingId, reason_code: reasonCode, reason: "Table damaged (test)", expected_version: version }));

const journals = (bookingId: string) =>
  sql`select kind from public.ledger_journals where booking_id = ${bookingId}::uuid order by created_at`.then((rows) => rows.map((r) => r.kind));
const refundsOf = (bookingId: string) =>
  sql`select id, amount_paise, reason_code, status, operation_key, payment_attempt_id from public.refunds
      where booking_id = ${bookingId}::uuid order by created_at`;

// Every journal touching the booking balances (debits = credits).
async function expectBalanced(bookingId: string) {
  const rows = await sql`
    select j.id, sum(case when l.side = 'DEBIT' then l.amount_paise else -l.amount_paise end)::bigint as net
    from public.ledger_journals j join public.ledger_entries l on l.journal_id = j.id
    where j.booking_id = ${bookingId}::uuid group by j.id`;
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) expect(Number(row.net)).toBe(0);
}

describe("refund terms at the cutoff boundary (pure, database clock injected)", () => {
  it("gives the early refund exactly at the cutoff and the late refund one microsecond after", async () => {
    const { hold } = await confirmedBooking();
    // Instants relative to the booking start, kept as text end to end: a timestamptz parameter goes through a
    // JavaScript Date in postgres.js and would lose the microseconds.
    const instant = (offset: string) =>
      sql`select (start_at + ${offset}::interval)::text as t from public.bookings where id = ${hold.booking_id}::uuid`.then((r) => r[0]!.t as string);
    const terms = (now: string, kind = "CUSTOMER", captured = 36000) => sql`
      select app.cancellation_terms(b, ${captured}::bigint, ${now}::text::timestamptz, ${kind}) as t
      from public.bookings b where b.id = ${hold.booking_id}::uuid`.then((r) => r[0]!.t as Record<string, unknown>);

    expect(await terms(await instant("-02:00:00"))).toMatchObject({
      window: "EARLY", refund_bps: 10000, refund_paise: 36000, retained_paise: 0, cutoff_minutes: 120, minutes_before_start: 120
    });
    const after = await instant("-01:59:59.999999");
    expect(await terms(after)).toMatchObject({ window: "LATE", refund_bps: 0, refund_paise: 0, retained_paise: 36000 });
    expect(await terms(await instant("00:00:00"))).toMatchObject({ window: "LATE", minutes_before_start: 0 });
    // Venue/service cancellation is always 100%, even inside the late window.
    expect(await terms(after, "SERVICE")).toMatchObject({ window: "SERVICE", refund_bps: 10000, refund_paise: 36000 });
  });

  it("rounds partial refunds half up in whole paise", async () => {
    const { hold } = await confirmedBooking();
    const [row] = await sql`
      select app.cancellation_terms(
        jsonb_populate_record(b, jsonb_build_object('policy_snapshot', jsonb_set(b.policy_snapshot, '{early_refund_bps}', '5000'))),
        33333::bigint, b.start_at - interval '1 day', 'CUSTOMER') as t
      from public.bookings b where b.id = ${hold.booking_id}::uuid`;
    expect(row!.t).toMatchObject({ window: "EARLY", refund_paise: 16667, retained_paise: 16666 });
  });
});

describe("customer cancellation (C10, T09)", () => {
  it("cancels early with a full refund liability, frees the table, and processes the refund once", async () => {
    const { customer, hold, booking, resourceId, startAt } = await confirmedBooking("early");
    const shown = await preview(customer, hold.booking_id);
    expect(shown).toMatchObject({ window: "EARLY", refund_paise: booking.total_paise, retained_paise: 0, booking_version: booking.version, currency: "INR" });
    expect(new Date(shown.preview_expires_at as string).getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60_000 + 5_000);

    const result = await cancel(customer, hold.booking_id, booking.version, booking.total_paise);
    expect(result).toMatchObject({ status: "CANCELLED", window: "EARLY", refund_paise: booking.total_paise, refund_status: "REQUESTED" });

    const [row] = await sql`select status, cancel_reason, checkin_token_hash, checkin_pin_hash from public.bookings where id = ${hold.booking_id}::uuid`;
    expect(row).toEqual({ status: "CANCELLED", cancel_reason: "CUSTOMER:CHANGE_OF_PLANS", checkin_token_hash: null, checkin_pin_hash: null });
    const [claim] = await sql`select active from public.inventory_claims where booking_id = ${hold.booking_id}::uuid`;
    expect(claim).toEqual({ active: false });
    const refunds = await refundsOf(hold.booking_id);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amount_paise: booking.total_paise, reason_code: "CUSTOMER_CANCEL", status: "REQUESTED",
                                       operation_key: `refund:booking:${hold.booking_id}:cancel` });
    expect(await journals(hold.booking_id)).toEqual(["CAPTURE_ALLOCATED_BOOKING", "CANCELLATION_REFUND_DUE"]);
    const jobs = await sql`select kind from public.outbox_jobs where business_key in
      (${`booking:${hold.booking_id}:cancelled`}, ${`refund:${refunds[0]!.id}:submit`}, ${`refund:${refunds[0]!.id}:requested`}) order by kind`;
    expect(jobs.map((j) => j.kind)).toEqual(["booking.cancelled", "refund.requested", "refund.submit"]);

    // The same table and time can be booked again by someone else.
    const other = await createUser(sql);
    const rebooked = await holdTable(sql, other, venue, startAt, { table: venue.tableIds.indexOf(resourceId) });
    expect(rebooked.status).toBe("HOLD");

    // The provider refund is submitted once (operation key = provider idempotency key), then shown as refunded.
    expect(await submitRefund(services(), refunds[0]!.id as string)).toBe("PROCESSED");
    expect(await submitRefund(services(), refunds[0]!.id as string)).toBe("PROCESSED");
    const [mock] = await sql`select count(*)::int as n from mock_gateway.refunds where idempotency_key = ${refunds[0]!.operation_key as string}`;
    expect(mock!.n).toBe(1);
    expect(await journals(hold.booking_id)).toEqual(["CAPTURE_ALLOCATED_BOOKING", "CANCELLATION_REFUND_DUE", "REFUND_PROCESSED"]);
    await expectBalanced(hold.booking_id);
    const seen = await asUser(sql, claimsFor(customer), (tx) => customerBooking(tx, hold.booking_id));
    expect(seen).toMatchObject({ status: "CANCELLED", cancel_reason: "CUSTOMER:CHANGE_OF_PLANS" });
    expect(seen.refunds).toEqual([expect.objectContaining({ status: "PROCESSED", amount_paise: booking.total_paise, reason_code: "CUSTOMER_CANCEL" })]);
  });

  it("cancels inside the cutoff with no refund and no refund liability", async () => {
    const { customer, hold, booking } = await confirmedBooking("late");
    const shown = await preview(customer, hold.booking_id);
    expect(shown).toMatchObject({ window: "LATE", refund_paise: 0, retained_paise: booking.total_paise });
    const result = await cancel(customer, hold.booking_id, booking.version, 0, null);
    expect(result).toMatchObject({ status: "CANCELLED", window: "LATE", refund_paise: 0, refund_id: null, refund_status: null });
    expect(await refundsOf(hold.booking_id)).toHaveLength(0);
    expect(await journals(hold.booking_id)).toEqual(["CAPTURE_ALLOCATED_BOOKING"]);
    const [row] = await sql`select cancel_reason from public.bookings where id = ${hold.booking_id}::uuid`;
    expect(row).toEqual({ cancel_reason: "CUSTOMER:UNSPECIFIED" });
  });

  it("refuses when the refund shown no longer applies, returning the new terms and changing nothing", async () => {
    const { customer, hold, booking } = await confirmedBooking("late");
    // The customer saw a full refund earlier; it is now inside the cutoff.
    const details = await expectDomainError(cancel(customer, hold.booking_id, booking.version, booking.total_paise), "CANCELLATION_CHANGED");
    expect(details).toMatchObject({ window: "LATE", refund_paise: 0, booking_version: booking.version });
    const [row] = await sql`select status from public.bookings where id = ${hold.booking_id}::uuid`;
    expect(row).toEqual({ status: "CONFIRMED" });
    await expectDomainError(cancel(customer, hold.booking_id, booking.version + 1, 0), "STALE_VERSION");
  });

  it("cancels once: a repeat is refused and leaves exactly one refund", async () => {
    const { customer, hold, booking } = await confirmedBooking("early");
    await cancel(customer, hold.booking_id, booking.version, booking.total_paise);
    await expectDomainError(cancel(customer, hold.booking_id, booking.version, booking.total_paise), "INVALID_TRANSITION");
    await expectDomainError(preview(customer, hold.booking_id), "INVALID_TRANSITION");
    expect(await refundsOf(hold.booking_id)).toHaveLength(1);
  });

  it("allows concurrent cancels of one booking to produce one cancellation and one refund", async () => {
    const { customer, hold, booking } = await confirmedBooking("early");
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => cancel(customer, hold.booking_id, booking.version, booking.total_paise)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect((r.reason as { code?: string }).code).toMatch(/INVALID_TRANSITION|STALE_VERSION/);
    expect(await refundsOf(hold.booking_id)).toHaveLength(1);
    const events = await sql`select count(*)::int as n from public.booking_events where booking_id = ${hold.booking_id}::uuid and event_type = 'CANCELLED'`;
    expect(events[0]!.n).toBe(1);
  });

  it("hides other customers' bookings (NOT_FOUND)", async () => {
    const { hold, booking } = await confirmedBooking("early");
    await expectDomainError(preview(outsider, hold.booking_id), "NOT_FOUND");
    await expectDomainError(cancel(outsider, hold.booking_id, booking.version, booking.total_paise), "NOT_FOUND");
    await expectDomainError(cancel(staff, hold.booking_id, booking.version, booking.total_paise), "NOT_FOUND");
  });

  it("refuses checked-in and already-started bookings", async () => {
    const soon = await confirmedBooking("soon");
    const codes = arrivalCodes(services().arrivalSecret, soon.hold.booking_id);
    const checkedIn = await asUser(sql, claimsFor(staff, { aal: "aal2" }), (tx) =>
      staffCheckIn(tx, { venue_id: venue.venueId, qr_token: codes.qrToken, public_ref: null, pin: null }));
    expect(checkedIn).toMatchObject({ outcome: "CHECKED_IN" });
    await expectDomainError(cancel(soon.customer, soon.hold.booking_id, soon.booking.version, 0), "INVALID_TRANSITION");
    await expectDomainError(serviceCancel(manager, soon.hold.booking_id, soon.booking.version + 1), "INVALID_TRANSITION");

    // Test-only clock travel: move a confirmed booking into the past with triggers disabled for this one statement.
    const { customer, hold, booking } = await confirmedBooking("early");
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update public.bookings set start_at = now() - interval '10 minutes', end_at = now() + interval '50 minutes'
               where id = ${hold.booking_id}::uuid`;
    });
    const details = await expectDomainError(cancel(customer, hold.booking_id, booking.version, 0), "INVALID_TRANSITION");
    expect(details).toEqual({ reason: "started" });
    await expectDomainError(preview(customer, hold.booking_id), "INVALID_TRANSITION");
  });

  it("refunds only the booking's own capture when a duplicate capture is already being refunded", async () => {
    const { customer, hold, booking } = await confirmedBooking("early", { duplicateCapture: true });
    const before = await refundsOf(hold.booking_id);
    expect(before.map((r) => r.reason_code)).toEqual(["DUPLICATE_CAPTURE"]);
    await cancel(customer, hold.booking_id, booking.version, booking.total_paise);
    const refunds = await refundsOf(hold.booking_id);
    expect(refunds.map((r) => [r.reason_code, Number(r.amount_paise)])).toEqual([
      ["DUPLICATE_CAPTURE", booking.total_paise], ["CUSTOMER_CANCEL", booking.total_paise]
    ]);
    expect(refunds[0]!.payment_attempt_id).not.toBe(refunds[1]!.payment_attempt_id);
    for (const r of refunds) expect(await submitRefund(services(), r.id as string)).toBe("PROCESSED");
    await expectBalanced(hold.booking_id);

    // No attempt can be refunded beyond what it captured (raw insert: the trigger's error is the message, not a domain code).
    await expect(
      sql`insert into public.refunds (payment_attempt_id, booking_id, amount_paise, currency, reason_code, operation_key)
          values (${refunds[1]!.payment_attempt_id as string}::uuid, ${hold.booking_id}::uuid, 1, 'INR', 'CUSTOMER_CANCEL', ${crypto.randomUUID()})`
    ).rejects.toThrow("INVALID_TRANSITION");
  });

  it("serializes cancel against check-in: exactly one wins", async () => {
    for (let round = 0; round < 3; round += 1) {
      const { customer, hold, booking } = await confirmedBooking("soon");
      const codes = arrivalCodes(services().arrivalSecret, hold.booking_id);
      const [c, k] = await Promise.allSettled([
        cancel(customer, hold.booking_id, booking.version, 0),
        asUser(sql, claimsFor(staff, { aal: "aal2" }), (tx) =>
          staffCheckIn(tx, { venue_id: venue.venueId, qr_token: codes.qrToken, public_ref: null, pin: null }))
      ]);
      const [row] = await sql`select status from public.bookings where id = ${hold.booking_id}::uuid`;
      const checkedIn = k.status === "fulfilled" && (k.value as { outcome: string }).outcome === "CHECKED_IN";
      if (row!.status === "CANCELLED") {
        expect(c.status).toBe("fulfilled");
        expect(checkedIn).toBe(false);
      } else {
        expect(row!.status).toBe("CHECKED_IN");
        expect(checkedIn).toBe(true);
        expect(c.status).toBe("rejected");
      }
    }
  });
});

describe("venue/platform service cancellation (full refund, audited)", () => {
  it("lets a TOTP-verified manager cancel inside the late window with a full refund", async () => {
    const { customer, hold, booking } = await confirmedBooking("late");
    await expectDomainError(serviceCancel(manager, hold.booking_id, booking.version, "aal1"), "REAUTH_REQUIRED");
    await expectDomainError(serviceCancel(manager, hold.booking_id, booking.version, "aal2", "NOT_A_CODE"), "VALIDATION_FAILED");
    const result = await serviceCancel(manager, hold.booking_id, booking.version);
    expect(result).toMatchObject({ status: "CANCELLED", window: "SERVICE", refund_paise: booking.total_paise, refund_status: "REQUESTED" });
    expect((await refundsOf(hold.booking_id))[0]).toMatchObject({ reason_code: "SERVICE_CANCEL", amount_paise: booking.total_paise });
    const [audit] = await sql`select actor_role, reason, safe_diff from public.audit_events
                              where entity_id = ${hold.booking_id}::uuid and action = 'booking.service_cancel'`;
    expect(audit).toMatchObject({ actor_role: "VENUE_MANAGER", reason: "Table damaged (test)", safe_diff: { reason_code: "TABLE_UNAVAILABLE" } });
    const seen = await asUser(sql, claimsFor(customer), (tx) => customerBooking(tx, hold.booking_id));
    expect(seen).toMatchObject({ status: "CANCELLED", cancel_reason: "SERVICE:TABLE_UNAVAILABLE" });
  });

  it("lets platform support cancel; staff are forbidden and outsiders see nothing", async () => {
    const { hold, booking } = await confirmedBooking("early");
    await expectDomainError(serviceCancel(staff, hold.booking_id, booking.version), "FORBIDDEN");
    await expectDomainError(serviceCancel(outsider, hold.booking_id, booking.version), "NOT_FOUND");
    const result = await serviceCancel(support, hold.booking_id, booking.version);
    expect(result).toMatchObject({ status: "CANCELLED", window: "SERVICE" });
    const [audit] = await sql`select actor_role from public.audit_events where entity_id = ${hold.booking_id}::uuid and action = 'booking.service_cancel'`;
    expect(audit).toEqual({ actor_role: "PLATFORM_ADMIN" });
  });
});

describe("cancellation notifications (worker)", () => {
  it("queues one in-app and one email notice per cancellation, however often the job runs", async () => {
    const { customer, hold, booking } = await confirmedBooking("early");
    await cancel(customer, hold.booking_id, booking.version, booking.total_paise);
    for (let i = 0; i < 2; i += 1) {
      await asWorker(sql, (tx) => jobNotifyBooking(tx, hold.booking_id, `booking:${hold.booking_id}:cancelled`, "booking_cancelled"));
    }
    const rows = await sql`select channel, template from public.notifications
                           where booking_id = ${hold.booking_id}::uuid and template = 'booking_cancelled' order by channel`;
    expect(rows).toEqual([{ channel: "EMAIL", template: "booking_cancelled" }, { channel: "IN_APP", template: "booking_cancelled" }]);
  });
});
