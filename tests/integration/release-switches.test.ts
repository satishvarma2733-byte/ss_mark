// M6 release switches on real PostgreSQL (docs/06 rollback procedure, docs/08 s.4). Closing a switch stops new
// commitments at the database; existing bookings, payment ingestion, cancellations, refunds and check-in continue.
// Every test reopens what it closed; integration files run one at a time, so no other suite sees a closed switch.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminReleaseSwitches, adminSetReleaseSwitch, asAnon, asUser, beginExtensionCheckout, cancelBooking, cancelExtension, cancelPreview,
  createBookingHold, createQuote, decideExtension, holdExtension, requestExtension, serviceStatus, staffCheckIn, type Sql
} from "@simply-sit/db";
import { arrivalCodes } from "@simply-sit/domain";
import { applyPayment, ensureProviderOrder, startCheckout } from "@simply-sit/payments";
import {
  claimsFor, createUser, createVenue, expectDomainError, grantPlatformRole, grantVenueRole, holdTable, istSlot, nextGridSlot, openDb,
  paymentServices, type TestUser, type TestVenue
} from "./helpers";

let sql: Sql;
let venue: TestVenue;
let staff: TestUser;
let superadmin: TestUser;
let finance: TestUser;
let support: TestUser;

beforeAll(async () => {
  sql = openDb(10);
  venue = await createVenue(sql, {
    tables: Array.from({ length: 12 }, () => ({ capacity: 4, hourlyPaise: 30000 })),
    policy: { increment_minutes: 5, lead_minutes: 0 }, hours: { weekdays: [0, 1, 2, 3, 4, 5, 6], opens: "04:00", closes: "03:55" }
  });
  [staff, superadmin, finance, support] = [await createUser(sql), await createUser(sql), await createUser(sql), await createUser(sql)];
  await grantVenueRole(sql, venue.venueId, staff, "STAFF");
  await grantPlatformRole(sql, superadmin, "SUPERADMIN");
  await grantPlatformRole(sql, finance, "FINANCE");
  await grantPlatformRole(sql, support, "SUPPORT");
});
afterAll(async () => {
  await sql`update public.release_switches set is_open = true`;
  await sql.end();
});

const s = () => paymentServices(sql);
const as = (user: TestUser, aal: "aal1" | "aal2" = "aal2") => <T>(work: Parameters<typeof asUser<T>>[2]) => asUser(sql, claimsFor(user, { aal }), work);
const switchRow = (key: string) =>
  sql`select is_open, version from public.release_switches where key = ${key}`.then((r) => r[0] as { is_open: boolean; version: number });
async function setSwitch(key: "BOOKINGS" | "EXTENSIONS" | "PAYOUTS", open: boolean, actor: TestUser = superadmin) {
  const { version } = await switchRow(key);
  return as(actor)((tx) => adminSetReleaseSwitch(tx, { key, is_open: open, reason: `Test ${open ? "reopen" : "pause"} of ${key}`, expected_version: version }));
}
async function whileClosed(key: "BOOKINGS" | "EXTENSIONS", work: () => Promise<void>) {
  await setSwitch(key, false);
  try {
    await work();
  } finally {
    await setSwitch(key, true);
  }
}

let nextTable = 0;
const quoteFor = (customer: TestUser, startAt: string) =>
  as(customer, "aal1")((tx) => createQuote(tx, {
    venue_id: venue.venueId, resource_id: venue.tableIds[nextTable++ % venue.tableIds.length]!, start_at: startAt, duration_minutes: 60, party_size: 2
  }));

async function paidBooking(startAt: string, opts: { checkIn?: boolean } = {}) {
  const customer = await createUser(sql);
  const hold = await holdTable(sql, customer, venue, startAt, { table: nextTable++ % venue.tableIds.length });
  const { order } = await startCheckout(s(), claimsFor(customer), { bookingId: hold.booking_id, expectedVersion: hold.version }, crypto.randomUUID());
  expect((await applyPayment(s(), order, await s().gateway.simulatePayment(order.provider_order_id!, "capture"), "VERIFY")).outcome).toBe("CONFIRMED");
  if (opts.checkIn) {
    const codes = arrivalCodes(s().arrivalSecret, hold.booking_id);
    expect(await as(staff)((tx) => staffCheckIn(tx, { venue_id: venue.venueId, qr_token: codes.qrToken, public_ref: null, pin: null })))
      .toMatchObject({ outcome: "CHECKED_IN" });
  }
  const [row] = await sql`select version from public.bookings where id = ${hold.booking_id}::uuid`;
  return { customer, bookingId: hold.booking_id, version: row!.version as number };
}

describe("defaults", () => {
  it("treats a missing switch as closed and shows customers only the open/closed state", async () => {
    expect((await sql`select app.switch_open('NO_SUCH_SWITCH') as open`)[0]!.open).toBe(false);
    expect(await asAnon(sql, (tx) => serviceStatus(tx))).toEqual({ bookings_open: true, extensions_open: true });
    const [{ count }] = (await sql`select count(*)::int as count from public.release_switches`) as unknown as [{ count: number }];
    expect(count).toBe(3);
  });
});

describe("BOOKINGS switch", () => {
  it("blocks new quotes, holds and payment orders while existing payments, cancellations and refunds continue", async () => {
    const customer = await createUser(sql);
    const day = istSlot(3, "10:00");
    const readyQuote = await quoteFor(customer, day);
    const holder = await createUser(sql);
    const unpaidHold = await holdTable(sql, holder, venue, istSlot(3, "12:00"), { table: nextTable++ % venue.tableIds.length });
    const payer = await createUser(sql);
    const pendingHold = await holdTable(sql, payer, venue, istSlot(3, "14:00"), { table: nextTable++ % venue.tableIds.length });
    const { order: pendingOrder } = await startCheckout(s(), claimsFor(payer), { bookingId: pendingHold.booking_id, expectedVersion: pendingHold.version }, crypto.randomUUID());
    const confirmed = await paidBooking(istSlot(4, "10:00"));

    await whileClosed("BOOKINGS", async () => {
      expect(await asAnon(sql, (tx) => serviceStatus(tx))).toEqual({ bookings_open: false, extensions_open: true });
      await expectDomainError(quoteFor(customer, istSlot(3, "16:00")), "BOOKINGS_PAUSED");
      await expectDomainError(as(customer, "aal1")((tx) => createBookingHold(tx, {
        quote_id: readyQuote.quote_id, accepted_policy_hash: readyQuote.policy_hash, expected_quote_total_paise: readyQuote.price_snapshot.total_paise
      })), "BOOKINGS_PAUSED");
      await expectDomainError(startCheckout(s(), claimsFor(holder), { bookingId: unpaidHold.booking_id, expectedVersion: unpaidHold.version }, crypto.randomUUID()),
        "BOOKINGS_PAUSED");
      // A payment already under way is still verified and confirmed: money is never stranded by the switch.
      const capture = await s().gateway.simulatePayment(pendingOrder.provider_order_id!, "capture");
      expect((await applyPayment(s(), pendingOrder, capture, "WEBHOOK")).outcome).toBe("CONFIRMED");
      // Cancellation with refund is unaffected.
      const preview = (await as(confirmed.customer, "aal1")((tx) => cancelPreview(tx, confirmed.bookingId))) as { refund_paise: number };
      expect(await as(confirmed.customer, "aal1")((tx) => cancelBooking(tx, {
        booking_id: confirmed.bookingId, reason_code: "CHANGE_OF_PLANS", expected_version: confirmed.version, expected_refund_paise: preview.refund_paise
      }))).toMatchObject({ status: "CANCELLED" });
    });

    // Reopened: the quote taken before the pause still holds, and new quotes work.
    expect(await as(customer, "aal1")((tx) => createBookingHold(tx, {
      quote_id: readyQuote.quote_id, accepted_policy_hash: readyQuote.policy_hash, expected_quote_total_paise: readyQuote.price_snapshot.total_paise
    }))).toMatchObject({ status: "HOLD" });
    expect(await quoteFor(customer, istSlot(3, "18:00"))).toMatchObject({ quote_id: expect.any(String) });
  });
});

describe("EXTENSIONS switch", () => {
  type Ext = { extension_id: string; status: string; version: number; amount_paise: number };
  async function extension(stage: "approved" | "held") {
    const b = await paidBooking(nextGridSlot(5, 1), { checkIn: true });
    const requested = (await as(b.customer, "aal1")((tx) => requestExtension(tx, b.bookingId, 30, b.version))) as Ext;
    let ext = (await as(staff)((tx) => decideExtension(tx, requested.extension_id, { decision: "APPROVE", expected_version: requested.version }))) as Ext;
    if (stage === "held") ext = (await as(b.customer, "aal1")((tx) => holdExtension(tx, ext.extension_id, ext.amount_paise, ext.version))) as Ext;
    return { ...b, ext };
  }

  it("blocks new requests, holds and extension payment orders; an extension already being paid still applies", async () => {
    const fresh = await paidBooking(nextGridSlot(5, 1), { checkIn: true });
    const approved = await extension("approved");
    const held = await extension("held");
    const paying = await extension("held");
    const begun = await as(paying.customer, "aal1")((tx) =>
      beginExtensionCheckout(tx, { extension_id: paying.ext.extension_id, expected_version: paying.ext.version, provider: "mock", environment: "TEST" }));
    const payingOrder = await ensureProviderOrder(s(), begun);

    await whileClosed("EXTENSIONS", async () => {
      expect(await asAnon(sql, (tx) => serviceStatus(tx))).toEqual({ bookings_open: true, extensions_open: false });
      await expectDomainError(as(fresh.customer, "aal1")((tx) => requestExtension(tx, fresh.bookingId, 30, fresh.version)), "EXTENSIONS_PAUSED");
      await expectDomainError(as(approved.customer, "aal1")((tx) => holdExtension(tx, approved.ext.extension_id, approved.ext.amount_paise, approved.ext.version)),
        "EXTENSIONS_PAUSED");
      await expectDomainError(as(held.customer, "aal1")((tx) =>
        beginExtensionCheckout(tx, { extension_id: held.ext.extension_id, expected_version: held.ext.version, provider: "mock", environment: "TEST" })),
      "EXTENSIONS_PAUSED");
      expect(await applyPayment(s(), payingOrder, await s().gateway.simulatePayment(payingOrder.provider_order_id!, "capture"), "VERIFY"))
        .toMatchObject({ outcome: "EXTENDED", extension_status: "APPLIED" });
      expect(await as(held.customer, "aal1")((tx) => cancelExtension(tx, held.ext.extension_id))).toMatchObject({ status: "CANCELLED" });
      // New bookings are a separate switch.
      expect(await quoteFor(fresh.customer, istSlot(5, "10:00"))).toMatchObject({ quote_id: expect.any(String) });
    });
    expect(await as(approved.customer, "aal1")((tx) => holdExtension(tx, approved.ext.extension_id, approved.ext.amount_paise, approved.ext.version)))
      .toMatchObject({ status: "HELD" });
  });
});

describe("PAYOUTS switch", () => {
  it("blocks payout approval and PROCESSING but not other payout states", async () => {
    // Inside one rolled-back transaction: the guard fires before the batch's own approval constraints.
    const outcome = await sql.begin(async (tx) => {
      await tx`update public.release_switches set is_open = false where key = 'PAYOUTS'`;
      const [batch] = await tx`
        insert into public.payout_batches (public_ref, partner_id, amount_paise, earnings_paise, adjustments_paise, period_start, period_end, created_by)
        values ('PB-SWITCH-' || substr(md5(random()::text), 1, 8), ${venue.partnerId}::uuid, 100, 100, 0, now() - interval '1 day', now(), ${finance.profileId}::uuid)
        returning id`;
      const attempt = async (status: string) => {
        try {
          await tx.savepoint((sp) => sp`update public.payout_batches set status = ${status} where id = ${batch!.id}::uuid`);
          return "updated";
        } catch (error) {
          return (error as Error).message;
        }
      };
      const result = { approve: await attempt("APPROVED"), cancel: await attempt("CANCELLED") };
      throw Object.assign(new Error("rollback"), { result });
    }).catch((error: { result?: unknown }) => error.result);
    expect(outcome).toEqual({ approve: "PAYOUTS_PAUSED", cancel: "updated" });
    expect((await switchRow("PAYOUTS")).is_open).toBe(true);
  });
});

describe("changing a switch", () => {
  it("lets every admin role see the switches; only superadmin changes sales and finance may change payouts", async () => {
    const listed = await as(support)((tx) => adminReleaseSwitches(tx));
    expect(listed.items.map((i) => [i.key, i.can_change])).toEqual([["BOOKINGS", false], ["EXTENSIONS", false], ["PAYOUTS", false]]);
    expect((await as(finance)((tx) => adminReleaseSwitches(tx))).items.map((i) => i.can_change)).toEqual([false, false, true]);
    await expectDomainError(setSwitch("BOOKINGS", false, support), "FORBIDDEN");
    await expectDomainError(setSwitch("BOOKINGS", false, finance), "FORBIDDEN");
    await expectDomainError(setSwitch("BOOKINGS", false, await createUser(sql)), "FORBIDDEN");
    await expectDomainError(as(superadmin, "aal1")((tx) => adminReleaseSwitches(tx)), "REAUTH_REQUIRED");
    await expect(asAnon(sql, (tx) => adminReleaseSwitches(tx))).rejects.toThrow(/permission denied/);

    expect(await setSwitch("PAYOUTS", false, finance)).toMatchObject({ key: "PAYOUTS", is_open: false, changed: true });
    expect(await setSwitch("PAYOUTS", false, finance)).toMatchObject({ is_open: false, changed: false });
    expect(await setSwitch("PAYOUTS", true, superadmin)).toMatchObject({ is_open: true, changed: true });
  });

  it("requires a reason and the current version, and audits the change", async () => {
    const { version } = await switchRow("BOOKINGS");
    await expectDomainError(as(superadmin)((tx) => adminSetReleaseSwitch(tx, { key: "BOOKINGS", is_open: false, reason: "short", expected_version: version })),
      "VALIDATION_FAILED");
    await expectDomainError(as(superadmin)((tx) => adminSetReleaseSwitch(tx, { key: "BOOKINGS", is_open: false, reason: "Stale version test", expected_version: version - 1 })),
      "STALE_VERSION");
    const requestId = crypto.randomUUID();
    await as(superadmin)((tx) => adminSetReleaseSwitch(tx, { key: "BOOKINGS", is_open: false, reason: "Incident drill: pause sales", expected_version: version }, requestId));
    await setSwitch("BOOKINGS", true);
    const [audit] = await sql`select actor_id, actor_role, action, reason, safe_diff from public.audit_events where request_id = ${requestId}::uuid`;
    expect(audit).toMatchObject({
      actor_id: superadmin.profileId, actor_role: "SUPERADMIN", action: "release_switch.closed", reason: "Incident drill: pause sales",
      safe_diff: { key: "BOOKINGS", is_open: false }
    });
  });
});
