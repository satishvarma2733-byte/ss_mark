// M3 review follow-ups on real PostgreSQL: reconciliation selection and pacing (F1/F17), observation history (F1/F12),
// refund recovery (F2), refund/observation lock order (F3), verify gating (F5), and the race/cutoff gaps the review
// listed (docs/07 s.8, docs/08 T05/T08/T10/T16).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser, asWorker, cancelHold, customerBooking, ordersToReconcile, queueMetrics, recordRefundResult, type Sql
} from "@simply-sit/db";
import {
  applyPayment, observeOrderPayments, reconcileRefunds, RetryLaterError, startCheckout, submitRefund, verifyForCustomer
} from "@simply-sit/payments";
import type { GatewayPayment } from "@simply-sit/providers";
import {
  claimsFor, createUser, createVenue, grantPlatformRole, holdTable, istSlot, makeHoldDue, openDb, paymentServices,
  type TestUser, type TestVenue
} from "./helpers";

let sql: Sql;
let venue: TestVenue;
let slot = 0;
const services = () => paymentServices(sql);

beforeAll(async () => {
  sql = openDb(30);
  venue = await createVenue(sql, { tables: Array.from({ length: 6 }, () => ({ capacity: 4, hourlyPaise: 30000 })) });
});
afterAll(async () => {
  await sql.end();
});

function nextSlot(): string {
  slot += 1;
  return istSlot(2 + (slot % 25), `${String(8 + (slot % 12)).padStart(2, "0")}:30`);
}

async function heldAndReady(user: TestUser, table = 0) {
  const hold = await holdTable(sql, user, venue, nextSlot(), { table });
  const { order } = await startCheckout(services(), claimsFor(user), { bookingId: hold.booking_id, expectedVersion: hold.version }, crypto.randomUUID());
  expect(order.state).toBe("READY");
  return { hold, order };
}

// Confirmed booking plus a second capture, so a full refund liability exists for it.
async function duplicateCaptureRefund() {
  const user = await createUser(sql);
  const { hold, order } = await heldAndReady(user, slot % 6);
  await services().gateway.simulatePayment(order.provider_order_id!, "capture");
  await services().gateway.simulatePayment(order.provider_order_id!, "capture");
  await observeOrderPayments(services(), order, "RECONCILE");
  const [refund] = await sql`select id from public.refunds where booking_id = ${hold.booking_id}::uuid`;
  return { user, hold, order, refundId: refund!.id as string };
}

// Claims reconciliation batches until the order appears or nothing is left to claim.
async function claimedInReconciliation(orderId: string): Promise<boolean> {
  for (let i = 0; i < 30; i += 1) {
    const batch = await asWorker(sql, (tx) => ordersToReconcile(tx, 100));
    if (batch.some((o) => o.payment_order_id === orderId)) return true;
    if (batch.length === 0) return false;
  }
  return false;
}

describe("reconciliation selection and pacing (review F1, F17)", () => {
  it("polls a live hold, then not again within its interval, and drops paid bookings older than a day", async () => {
    const { order } = await heldAndReady(await createUser(sql));
    await sql`update public.payment_orders set created_at = clock_timestamp() - interval '2 minutes' where id = ${order.payment_order_id}::uuid`;
    expect(await claimedInReconciliation(order.payment_order_id)).toBe(true);
    expect(await claimedInReconciliation(order.payment_order_id)).toBe(false); // claimed: reconciled_at was set

    const user = await createUser(sql);
    const paid = await heldAndReady(user, 1);
    await services().gateway.simulatePayment(paid.order.provider_order_id!, "capture");
    await observeOrderPayments(services(), paid.order, "VERIFY");
    await sql`update public.payment_orders set reconciled_at = null where id = ${paid.order.payment_order_id}::uuid`;
    expect(await claimedInReconciliation(paid.order.payment_order_id)).toBe(true); // confirmed today: still watched
    await sql`update public.bookings set confirmed_at = clock_timestamp() - interval '2 days' where id = ${paid.hold.booking_id}::uuid`;
    await sql`update public.payment_orders set reconciled_at = null where id = ${paid.order.payment_order_id}::uuid`;
    expect(await claimedInReconciliation(paid.order.payment_order_id)).toBe(false);
  });

  it("stores an observation only when it differs from the last one for that payment", async () => {
    const user = await createUser(sql);
    const { hold, order } = await heldAndReady(user, 2);
    await services().gateway.simulatePayment(order.provider_order_id!, "capture");
    for (let i = 0; i < 4; i += 1) await observeOrderPayments(services(), order, "RECONCILE");
    const [events] = await sql`select count(*)::int as n from public.payment_attempt_events e
                               join public.payment_attempts a on a.id = e.payment_attempt_id where a.booking_id = ${hold.booking_id}::uuid`;
    expect(events!.n).toBe(1);
  });

  it("quarantines a payment whose reported amount changes after it was first seen (review F12)", async () => {
    const user = await createUser(sql);
    const { hold, order } = await heldAndReady(user, 3);
    const base: GatewayPayment = {
      providerPaymentId: `pay_mock_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`, providerOrderId: order.provider_order_id!,
      amountPaise: order.expected_amount_paise, currency: "INR", state: "PENDING", capturedAt: null
    };
    expect((await applyPayment(services(), order, base, "WEBHOOK")).outcome).toBe("RECORDED");
    const changed = await applyPayment(services(), order, { ...base, state: "CAPTURED", amountPaise: order.expected_amount_paise - 500 }, "WEBHOOK");
    expect(changed.outcome).toBe("QUARANTINED");
    const booking = await asUser(sql, claimsFor(user), (tx) => customerBooking(tx, hold.booking_id));
    expect(booking.status).toBe("PENDING_PAYMENT");
    const amounts = await sql`select e.amount_paise from public.payment_attempt_events e join public.payment_attempts a on a.id = e.payment_attempt_id
                              where a.booking_id = ${hold.booking_id}::uuid order by e.created_at`;
    expect(amounts.map((r) => Number(r.amount_paise))).toEqual([order.expected_amount_paise, order.expected_amount_paise - 500]);
  });
});

describe("cutoff and races (docs/07 s.8, T05/T08)", () => {
  it("applies the strict cutoff: a capture timestamped inside the hold but observed after expiry is refund-due", async () => {
    const user = await createUser(sql);
    const { hold, order } = await heldAndReady(user, 4);
    const payment = await services().gateway.simulatePayment(order.provider_order_id!, "capture"); // captured now, hold live
    await makeHoldDue(sql, hold.booking_id);
    const outcome = await applyPayment(services(), order, payment, "WEBHOOK");
    expect(outcome).toMatchObject({ outcome: "REFUND_DUE", booking_status: "EXPIRED" });
    const [refund] = await sql`select reason_code from public.refunds where booking_id = ${hold.booking_id}::uuid`;
    expect(refund).toEqual({ reason_code: "LATE_CAPTURE" });
  });

  it("serializes a customer cancelling a hold against its capture: one consistent outcome every time", async () => {
    for (let i = 0; i < 5; i += 1) {
      const user = await createUser(sql);
      const { hold, order } = await heldAndReady(user, 5);
      const payment = await services().gateway.simulatePayment(order.provider_order_id!, "capture");
      const current = await asUser(sql, claimsFor(user), (tx) => customerBooking(tx, hold.booking_id));
      const [cancel, capture] = await Promise.allSettled([
        asUser(sql, claimsFor(user), (tx) => cancelHold(tx, hold.booking_id, current.version as number)),
        applyPayment(services(), order, payment, "WEBHOOK")
      ]);
      expect(capture.status).toBe("fulfilled");
      const [booking] = await sql`select status from public.bookings where id = ${hold.booking_id}::uuid`;
      const [claims] = await sql`select count(*)::int as n from public.inventory_claims where booking_id = ${hold.booking_id}::uuid and active`;
      const [refunds] = await sql`select count(*)::int as n from public.refunds where booking_id = ${hold.booking_id}::uuid`;
      if (booking!.status === "CONFIRMED") {
        expect(cancel.status).toBe("rejected");
        expect([claims!.n, refunds!.n]).toEqual([1, 0]);
      } else {
        expect(booking!.status).toBe("CANCELLED");
        expect(cancel.status).toBe("fulfilled");
        expect([claims!.n, refunds!.n]).toEqual([0, 1]);
      }
    }
  });
});

describe("refund recovery (review F2, F3; T10, T16)", () => {
  it("re-submits a refund whose job died during a provider outage, with the same key, once the provider is back", async () => {
    const { refundId } = await duplicateCaptureRefund();
    const down = paymentServices(sql, { create_refund: "unavailable" });
    await expect(submitRefund(down, refundId)).rejects.toBeInstanceOf(RetryLaterError);
    // Simulate the submit job exhausting its retries during the outage.
    await sql`update public.outbox_jobs set status = 'DEAD' where business_key = ${`refund:${refundId}:submit`}`;
    await sql`update public.refunds set created_at = clock_timestamp() - interval '10 minutes' where id = ${refundId}::uuid`;

    const result = await reconcileRefunds(services(), 100);
    expect(result.checked).toBeGreaterThanOrEqual(1);
    const [refund] = await sql`select status, provider_refund_id, operation_key from public.refunds where id = ${refundId}::uuid`;
    expect(refund!.status).toBe("PROCESSED");
    const [mock] = await sql`select count(*)::int as n from mock_gateway.refunds where idempotency_key = ${refund!.operation_key as string}`;
    expect(mock!.n).toBe(1);
  });

  it("recovers a refund whose response was lost (UNKNOWN) without refunding twice", async () => {
    const { refundId } = await duplicateCaptureRefund();
    const lost = paymentServices(sql, { create_refund: "timeout_after_create" });
    await expect(submitRefund(lost, refundId)).rejects.toBeInstanceOf(RetryLaterError);
    const [unknown] = await sql`select status, operation_key from public.refunds where id = ${refundId}::uuid`;
    expect(unknown!.status).toBe("UNKNOWN");
    await sql`update public.outbox_jobs set status = 'DEAD' where business_key = ${`refund:${refundId}:submit`}`;
    await sql`update public.refunds set created_at = clock_timestamp() - interval '10 minutes' where id = ${refundId}::uuid`;

    await reconcileRefunds(services(), 100);
    const [after] = await sql`select status from public.refunds where id = ${refundId}::uuid`;
    expect(after!.status).toBe("PROCESSED");
    const [mock] = await sql`select count(*)::int as n from mock_gateway.refunds where idempotency_key = ${unknown!.operation_key as string}`;
    expect(mock!.n).toBe(1);
    const [journals] = await sql`select count(*)::int as n from public.ledger_journals where refund_id = ${refundId}::uuid`;
    expect(journals!.n).toBe(1);
  });

  it("audits a FAILED refund and reports open and failed refunds in queue metrics", async () => {
    const { refundId } = await duplicateCaptureRefund();
    await asWorker(sql, (tx) => recordRefundResult(tx, refundId, "FAILED", null, "PROVIDER_REJECTED"));
    const [audit] = await sql`select action, reason from public.audit_events where entity_id = ${refundId}::uuid`;
    expect(audit).toEqual({ action: "refund.failed", reason: "PROVIDER_REJECTED" });
    const admin = await createUser(sql);
    await grantPlatformRole(sql, admin, "SUPERADMIN");
    const metrics = await asUser(sql, claimsFor(admin, { aal: "aal2" }), (tx) => queueMetrics(tx));
    expect(Number(metrics.refunds_failed)).toBeGreaterThanOrEqual(1);
    expect(metrics).toHaveProperty("refunds_stalled");
    expect(metrics).toHaveProperty("payments_quarantined");
  });

  it("runs refund results and re-observations of the same payment concurrently without deadlocking", async () => {
    for (let i = 0; i < 4; i += 1) {
      const { order, refundId } = await duplicateCaptureRefund();
      const results = await Promise.allSettled([
        submitRefund(services(), refundId),
        observeOrderPayments(services(), order, "RECONCILE"),
        observeOrderPayments(services(), order, "RECONCILE")
      ]);
      const failures = results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason?.code);
      expect(failures).toEqual([]);
      const [refund] = await sql`select status from public.refunds where id = ${refundId}::uuid`;
      expect(refund!.status).toBe("PROCESSED");
    }
  });
});

describe("verify gating (review F5)", () => {
  it("does not call the provider again for a booking that is already paid", async () => {
    const user = await createUser(sql);
    const { order } = await heldAndReady(user, 0);
    await services().gateway.simulatePayment(order.provider_order_id!, "capture");
    const first = await verifyForCustomer(services(), claimsFor(user), order.payment_order_id, {});
    expect(first.order.booking.status).toBe("CONFIRMED");
    // With the provider down, a gated verify still answers from the database and reports the provider as reachable,
    // because it never tried to call it.
    const down = paymentServices(sql, { fetch: "unavailable" });
    const again = await verifyForCustomer(down, claimsFor(user), order.payment_order_id, {});
    expect(again).toMatchObject({ providerReachable: true });
    expect(again.order.booking.status).toBe("CONFIRMED");
  });
});

describe("who can read the M3 money and arrival records (RLS)", () => {
  it("limits refunds and observations to the owner and MFA finance, and the arrival log to MFA managers/superadmins", async () => {
    const { user, hold, refundId } = await duplicateCaptureRefund();
    const [stranger, staff, manager, admin, finance] = await Promise.all(
      [1, 2, 3, 4, 5].map(() => createUser(sql)));
    await sql`insert into public.venue_memberships (venue_id, user_id, role, status, accepted_at) values
              (${venue.venueId}::uuid, ${staff.profileId}::uuid, 'STAFF', 'ACTIVE', now()),
              (${venue.venueId}::uuid, ${manager.profileId}::uuid, 'MANAGER', 'ACTIVE', now())`;
    await grantPlatformRole(sql, admin, "SUPERADMIN");
    await grantPlatformRole(sql, finance, "FINANCE");
    await sql`insert into public.arrival_attempts (venue_id, staff_profile_id, method, outcome)
              values (${venue.venueId}::uuid, ${staff.profileId}::uuid, 'PIN', 'FAILED')`;

    const count = async (who: TestUser, aal: "aal1" | "aal2", query: string) =>
      (await asUser(sql, claimsFor(who, { aal }), (tx) => tx.unsafe(query))).length;
    const refunds = `select id from public.refunds where id = '${refundId}'`;
    const attempts = `select id from public.payment_attempts where booking_id = '${hold.booking_id}'`;
    const events = `select e.id from public.payment_attempt_events e join public.payment_attempts a on a.id = e.payment_attempt_id
                    where a.booking_id = '${hold.booking_id}'`;
    const providerEvents = `select id from public.provider_events limit 1`;
    const arrivals = `select id from public.arrival_attempts where venue_id = '${venue.venueId}'`;

    expect(await count(user, "aal1", refunds)).toBe(1);
    expect(await count(user, "aal1", attempts)).toBe(2);
    for (const [who, aal] of [[stranger, "aal1"], [staff, "aal2"], [manager, "aal2"], [admin, "aal1"], [finance, "aal1"]] as const) {
      expect(await count(who, aal, refunds), `refunds ${aal}`).toBe(0);
      expect(await count(who, aal, attempts), `attempts ${aal}`).toBe(0);
    }
    expect(await count(finance, "aal2", refunds)).toBe(1);
    expect(await count(user, "aal1", events)).toBe(0);
    expect(await count(finance, "aal2", events)).toBeGreaterThan(0);
    expect(await count(user, "aal1", providerEvents)).toBe(0);
    expect(await count(staff, "aal2", arrivals)).toBe(0);
    expect(await count(manager, "aal1", arrivals)).toBe(0);
    expect(await count(manager, "aal2", arrivals)).toBe(1);
    expect(await count(admin, "aal1", arrivals)).toBe(0);
    expect(await count(admin, "aal2", arrivals)).toBe(1);
  });
});
