// M3.3/M3.4 payment truth on real PostgreSQL with the local mock gateway (docs/07 s.3, 7, 8; docs/08 T06, T07, T08, T16).
// No client value ever confirms a booking: every test below drives the server-side paths (verify, webhook, reconcile).
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon, asUser, asWorker, cancelHold, customerBooking, getPaymentOrder, ingestProviderEvent, processPaymentObservation,
  type PaymentOrderRow, type Sql
} from "@simply-sit/db";
import {
  applyPayment, observeOrderPayments, processProviderEvent, reconcileOrder, startCheckout, submitRefund, verifyForCustomer
} from "@simply-sit/payments";
import {
  claimsFor, createUser, createVenue, expectDomainError, grantPlatformRole, grantVenueRole, holdTable, istSlot, makeHoldDue,
  openDb, paymentServices, type TestUser, type TestVenue
} from "./helpers";

let sql: Sql;
let venue: TestVenue;
let day = 3;
const services = () => paymentServices(sql);

beforeAll(async () => {
  sql = openDb(30);
  venue = await createVenue(sql, { tables: [{ capacity: 4, hourlyPaise: 30000 }, { capacity: 4, hourlyPaise: 30000 }] });
});
afterAll(async () => {
  await sql.end();
});

// Each test uses its own slot so tests stay independent on one venue.
function nextSlot(): string {
  day += 1;
  return istSlot(day % 28 + 1, `${String(8 + (day % 12)).padStart(2, "0")}:00`);
}

async function heldAndReady(user: TestUser, opts: { table?: number; slot?: string } = {}) {
  const hold = await holdTable(sql, user, venue, opts.slot ?? nextSlot(), { table: opts.table ?? 0 });
  const { order } = await startCheckout(services(), claimsFor(user), { bookingId: hold.booking_id, expectedVersion: hold.version }, crypto.randomUUID());
  expect(order.state).toBe("READY");
  return { hold, order };
}

const bookingOf = (user: TestUser, id: string) => asUser(sql, claimsFor(user), (tx) => customerBooking(tx, id));
const journals = (bookingId: string) =>
  sql`select kind, business_key from public.ledger_journals where booking_id = ${bookingId}::uuid order by created_at`;

describe("confirmation needs a verified, exact capture (T06)", () => {
  it("confirms once from the provider's captured payment, with arrival hashes and one balanced allocation", async () => {
    const user = await createUser(sql);
    const { hold, order } = await heldAndReady(user);
    expect((await bookingOf(user, hold.booking_id)).status).toBe("PENDING_PAYMENT");

    await services().gateway.simulatePayment(order.provider_order_id!, "capture");
    const verified = await verifyForCustomer(services(), claimsFor(user), order.payment_order_id, {});
    expect(verified.order.booking.status).toBe("CONFIRMED");

    const [row] = await sql`select status, checkin_token_hash, checkin_pin_hash, confirmed_at from public.bookings where id = ${hold.booking_id}::uuid`;
    expect(row).toMatchObject({ status: "CONFIRMED" });
    expect(row!.checkin_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.checkin_pin_hash).toMatch(/^[0-9a-f]{64}$/);
    const [claim] = await sql`select active, expires_at from public.inventory_claims where booking_id = ${hold.booking_id}::uuid`;
    expect(claim).toEqual({ active: true, expires_at: null });
    expect(await journals(hold.booking_id)).toEqual([
      { kind: "CAPTURE_ALLOCATED_BOOKING", business_key: `allocation:booking:${hold.booking_id}` }
    ]);
    const [job] = await sql`select kind from public.outbox_jobs where business_key = ${`booking:${hold.booking_id}:confirmed`}`;
    expect(job).toEqual({ kind: "booking.confirmed" });

    // Verifying again changes nothing.
    await verifyForCustomer(services(), claimsFor(user), order.payment_order_id, {});
    expect(await journals(hold.booking_id)).toHaveLength(1);
  });

  it("ignores a client-claimed success: no provider payment means no confirmation", async () => {
    const user = await createUser(sql);
    const { hold, order } = await heldAndReady(user);
    const forged = await verifyForCustomer(services(), claimsFor(user), order.payment_order_id, {
      provider_payment_id: "pay_mock_forged", signature: "a".repeat(64)
    });
    expect(forged.callbackSignature).toBe("invalid");
    expect(forged.order.booking.status).toBe("PENDING_PAYMENT");
    expect(forged.order.booking.payment?.payment_state).toBe("NONE");
    expect(await journals(hold.booking_id)).toEqual([]);
  });

  it("does not confirm an authorized-but-uncaptured payment", async () => {
    const user = await createUser(sql);
    const { order } = await heldAndReady(user);
    await services().gateway.simulatePayment(order.provider_order_id!, "authorize");
    const result = await verifyForCustomer(services(), claimsFor(user), order.payment_order_id, {});
    expect(result.order.booking.status).toBe("PENDING_PAYMENT");
    expect(result.order.booking.payment?.payment_state).toBe("AUTHORIZED");
  });

  it("quarantines a wrong amount or currency and still confirms a later exact capture", async () => {
    const user = await createUser(sql);
    const { hold, order } = await heldAndReady(user);
    const gateway = services().gateway;
    await gateway.simulatePayment(order.provider_order_id!, "capture", { amountPaise: order.expected_amount_paise - 100 });
    await gateway.simulatePayment(order.provider_order_id!, "capture", { currency: "USD" });
    const mismatched = await verifyForCustomer(services(), claimsFor(user), order.payment_order_id, {});
    expect(mismatched.order.booking.status).toBe("PENDING_PAYMENT");
    expect(mismatched.order.booking.payment?.allocation).toBe("UNDER_REVIEW");
    const attempts = await sql`select allocation_state, last_error_code from public.payment_attempts where booking_id = ${hold.booking_id}::uuid`;
    expect(attempts.map((a) => a.allocation_state)).toEqual(["QUARANTINED", "QUARANTINED"]);
    const [audit] = await sql`select count(*)::int as n from public.audit_events where action = 'payment.quarantine'
                              and safe_diff ->> 'booking_id' = ${hold.booking_id}`;
    expect(audit!.n).toBe(2);

    await gateway.simulatePayment(order.provider_order_id!, "capture");
    const ok = await verifyForCustomer(services(), claimsFor(user), order.payment_order_id, {});
    expect(ok.order.booking.status).toBe("CONFIRMED");
    expect(await sql`select count(*)::int as n from public.payment_attempts where booking_id = ${hold.booking_id}::uuid and allocation_state = 'BOOKING'`)
      .toEqual([{ n: 1 }]);
  });

  it("rejects an observation for another order, provider environment or order reference", async () => {
    const user = await createUser(sql);
    const { order } = await heldAndReady(user);
    const other = await heldAndReady(await createUser(sql), { table: 1 });
    const payment = await services().gateway.simulatePayment(other.order.provider_order_id!, "capture");
    const crossed = await applyPayment(services(), order, payment, "VERIFY");
    expect(crossed.outcome).toBe("MISMATCHED_ORDER");
    // A gateway in another environment (e.g. LIVE keys) observing this TEST order is rejected (review F4).
    const base = services();
    const liveGateway = Object.create(base.gateway, { environment: { value: "LIVE" } }) as typeof base.gateway;
    const live = await applyPayment({ ...base, gateway: liveGateway }, order, { ...payment, providerOrderId: order.provider_order_id! }, "VERIFY");
    expect(live.outcome).toBe("MISMATCHED_ORDER");
    expect((await bookingOf(user, order.booking_id)).status).toBe("PENDING_PAYMENT");
    // Both rejected observations are kept as audit evidence (review F12).
    const [audit] = await sql`select count(*)::int as n from public.audit_events where action = 'payment.mismatched_order'
                              and (entity_id = ${order.payment_order_id}::uuid or safe_diff ->> 'observed_for_order' = ${order.payment_order_id})`;
    expect(audit!.n).toBeGreaterThanOrEqual(1);
  });

  it("never lets a customer token record a capture directly", async () => {
    const user = await createUser(sql);
    const { order } = await heldAndReady(user);
    await expect(
      asUser(sql, claimsFor(user), (tx) =>
        processPaymentObservation(tx, {
          order_id: order.payment_order_id, provider: "mock", environment: "TEST", provider_order_id: order.provider_order_id!,
          provider_payment_id: "pay_mock_self", amount_paise: order.expected_amount_paise, currency: "INR", state: "CAPTURED",
          captured_at: null, source: "VERIFY", provider_event_row_id: null, token_hash: "x", pin_hash: "y"
        }))
    ).rejects.toMatchObject({ code: "42501" });
    await expect(asAnon(sql, (tx) => tx`select app.apply_payment_observation(${order.payment_order_id}::uuid, 'mock', 'TEST',
      'o', 'p', 1, 'INR', 'CAPTURED', null, 'VERIFY', null, 'x', 'y')`)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("retries, duplicates and order of events (T07)", () => {
  it("keeps a failed attempt and a later capture as separate records", async () => {
    const user = await createUser(sql);
    const { hold, order } = await heldAndReady(user);
    const gateway = services().gateway;
    await gateway.simulatePayment(order.provider_order_id!, "fail");
    const failed = await verifyForCustomer(services(), claimsFor(user), order.payment_order_id, {});
    expect(failed.order.booking.status).toBe("PENDING_PAYMENT");
    expect(failed.order.booking.payment).toMatchObject({ payment_state: "FAILED", failed_attempts: 1 });
    await gateway.simulatePayment(order.provider_order_id!, "capture");
    const ok = await verifyForCustomer(services(), claimsFor(user), order.payment_order_id, {});
    expect(ok.order.booking.status).toBe("CONFIRMED");
    const attempts = await sql`select state from public.payment_attempts where booking_id = ${hold.booking_id}::uuid order by created_at`;
    expect(attempts.map((a) => a.state)).toEqual(["FAILED", "CAPTURED"]);
  });

  it("never regresses a captured payment when a delayed FAILED observation arrives", async () => {
    const user = await createUser(sql);
    const { hold, order } = await heldAndReady(user);
    const payment = await services().gateway.simulatePayment(order.provider_order_id!, "capture");
    expect((await applyPayment(services(), order, payment, "WEBHOOK")).outcome).toBe("CONFIRMED");
    const late = await applyPayment(services(), order, { ...payment, state: "FAILED" }, "WEBHOOK");
    expect(late).toMatchObject({ outcome: "RECORDED", attempt_state: "CAPTURED", booking_status: "CONFIRMED" });
    const events = await sql`select e.observed_state from public.payment_attempt_events e
                             join public.payment_attempts a on a.id = e.payment_attempt_id
                             where a.booking_id = ${hold.booking_id}::uuid order by e.created_at`;
    expect(events.map((e) => e.observed_state)).toEqual(["CAPTURED", "FAILED"]);
  });

  it("turns a second capture into a full refund liability, submitted once with one provider refund", async () => {
    const user = await createUser(sql);
    const { hold, order } = await heldAndReady(user);
    const gateway = services().gateway;
    await gateway.simulatePayment(order.provider_order_id!, "capture");
    await gateway.simulatePayment(order.provider_order_id!, "capture");
    await observeOrderPayments(services(), order, "RECONCILE");
    await observeOrderPayments(services(), order, "RECONCILE");
    const booking = await bookingOf(user, hold.booking_id);
    expect(booking.status).toBe("CONFIRMED");
    const refunds = await sql`select id, amount_paise, reason_code, status from public.refunds where booking_id = ${hold.booking_id}::uuid`;
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amount_paise: order.expected_amount_paise, reason_code: "DUPLICATE_CAPTURE", status: "REQUESTED" });

    const refundId = refunds[0]!.id as string;
    expect(await submitRefund(services(), refundId)).toBe("PROCESSED");
    expect(await submitRefund(services(), refundId)).toBe("PROCESSED");
    const [mock] = await sql`select count(*)::int as n from mock_gateway.refunds where idempotency_key = ${`refund:attempt:` + (await sql`select payment_attempt_id from public.refunds where id = ${refundId}::uuid`)[0]!.payment_attempt_id + ":full"}`;
    expect(mock!.n).toBe(1);
    expect((await journals(hold.booking_id)).map((j) => j.kind)).toEqual([
      "CAPTURE_ALLOCATED_BOOKING", "CAPTURE_REFUND_DUE", "REFUND_PROCESSED"
    ]);
    const [attempt] = await sql`select allocation_state from public.payment_attempts a join public.refunds r on r.payment_attempt_id = a.id
                                where r.id = ${refundId}::uuid`;
    expect(attempt).toEqual({ allocation_state: "REFUNDED" });
  });

  it("deduplicates webhook deliveries by provider event ID and applies the payment once", async () => {
    const user = await createUser(sql);
    const { hold, order } = await heldAndReady(user);
    const gateway = services().gateway;
    const payment = await gateway.simulatePayment(order.provider_order_id!, "capture");
    const ingest = () =>
      asWorker(sql, (tx) => ingestProviderEvent(tx, {
        provider: "mock", environment: "TEST", event_id: `evt_${hold.booking_id}`, event_type: "payment.captured",
        safe_payload: { provider_payment_id: payment.providerPaymentId }, payload_hash: createHash("sha256").update("x").digest("hex")
      }));
    const [first, second] = [await ingest(), await ingest()];
    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ event_row_id: first.event_row_id, duplicate: true });
    const [jobs] = await sql`select count(*)::int as n from public.outbox_jobs where business_key = ${`provider_event:${first.event_row_id}`}`;
    expect(jobs!.n).toBe(1);

    expect(await processProviderEvent(services(), first.event_row_id, false)).toBe("PROCESSED");
    expect(await processProviderEvent(services(), first.event_row_id, false)).toBe("PROCESSED");
    expect((await bookingOf(user, hold.booking_id)).status).toBe("CONFIRMED");
    expect(await journals(hold.booking_id)).toHaveLength(1);
  });

  it("retries a webhook that arrives before our order record, then quarantines on the final attempt", async () => {
    const gateway = services().gateway;
    const stray = await gateway.createOrder({ amountPaise: 1000, currency: "INR", receipt: `stray:${crypto.randomUUID()}` });
    const payment = await gateway.simulatePayment(stray.providerOrderId, "capture");
    const event = await asWorker(sql, (tx) => ingestProviderEvent(tx, {
      provider: "mock", environment: "TEST", event_id: `evt_stray_${payment.providerPaymentId}`, event_type: "payment.captured",
      safe_payload: { provider_payment_id: payment.providerPaymentId }, payload_hash: "h"
    }));
    await expect(processProviderEvent(services(), event.event_row_id, false)).rejects.toMatchObject({ code: "UNKNOWN_ORDER" });
    expect(await processProviderEvent(services(), event.event_row_id, true)).toBe("QUARANTINED");
    const [row] = await sql`select status, last_error_code from public.provider_events where id = ${event.event_row_id}::uuid`;
    expect(row).toEqual({ status: "QUARANTINED", last_error_code: "UNKNOWN_ORDER" });
  });

  it("confirms exactly once when the webhook and the customer's verify race", async () => {
    const user = await createUser(sql);
    const { hold, order } = await heldAndReady(user);
    const payment = await services().gateway.simulatePayment(order.provider_order_id!, "capture");
    const results = await Promise.all([
      applyPayment(services(), order, payment, "WEBHOOK"),
      verifyForCustomer(services(), claimsFor(user), order.payment_order_id, {}),
      applyPayment(services(), order, payment, "RECONCILE")
    ]);
    expect(results.filter((r) => "outcome" in r && r.outcome === "CONFIRMED").length).toBeLessThanOrEqual(1);
    expect((await bookingOf(user, hold.booking_id)).status).toBe("CONFIRMED");
    const [events] = await sql`select count(*)::int as n from public.booking_events where booking_id = ${hold.booking_id}::uuid and event_type = 'CONFIRMED'`;
    expect(events!.n).toBe(1);
    expect(await journals(hold.booking_id)).toHaveLength(1);
  });
});

describe("late money never revives inventory (T08)", () => {
  it("expires A, lets B book the table, then turns A's late capture into a refund liability", async () => {
    const [a, b] = [await createUser(sql), await createUser(sql)];
    const slot = nextSlot();
    const { hold: holdA, order: orderA } = await heldAndReady(a, { slot });
    await makeHoldDue(sql, holdA.booking_id);

    const holdB = await holdTable(sql, b, venue, slot); // expires A inside B's lock path
    expect((await bookingOf(a, holdA.booking_id)).status).toBe("EXPIRED");
    const expiredOrder = await asWorker(sql, (tx) => getPaymentOrder(tx, orderA.payment_order_id));
    expect(expiredOrder!.state).toBe("EXPIRED");

    await services().gateway.simulatePayment(orderA.provider_order_id!, "capture");
    const outcomes = await reconcileOrder(services(), expiredOrder!);
    expect(outcomes.map((o) => o.outcome)).toEqual(["REFUND_DUE"]);

    expect((await bookingOf(a, holdA.booking_id)).status).toBe("EXPIRED");
    const afterA = await bookingOf(a, holdA.booking_id);
    expect(afterA.refunds).toMatchObject([{ status: "REQUESTED", reason_code: "LATE_CAPTURE", amount_paise: orderA.expected_amount_paise }]);
    expect((await bookingOf(b, holdB.booking_id)).status).toBe("HOLD");
    const [claims] = await sql`select count(*)::int as n from public.inventory_claims where resource_id = ${venue.tableIds[0]!}::uuid
                               and active and blocked_range && (select blocked_range from public.inventory_claims where booking_id = ${holdB.booking_id}::uuid)`;
    expect(claims!.n).toBe(1);
    expect((await journals(holdA.booking_id)).map((j) => j.kind)).toEqual(["CAPTURE_REFUND_DUE"]);
  });

  it("treats a capture after the customer cancelled the hold as refund-due, in either order", async () => {
    const user = await createUser(sql);
    const { hold, order } = await heldAndReady(user);
    const booking = await bookingOf(user, hold.booking_id);
    await asUser(sql, claimsFor(user), (tx) => cancelHold(tx, hold.booking_id, booking.version as number));
    const [event] = await sql`select from_status from public.booking_events where booking_id = ${hold.booking_id}::uuid and event_type = 'HOLD_CANCELLED'`;
    expect(event).toEqual({ from_status: "PENDING_PAYMENT" });
    const payment = await services().gateway.simulatePayment(order.provider_order_id!, "capture");
    const outcome = await applyPayment(services(), order, payment, "WEBHOOK");
    expect(outcome).toMatchObject({ outcome: "REFUND_DUE", booking_status: "CANCELLED" });
    const [refund] = await sql`select reason_code from public.refunds where booking_id = ${hold.booking_id}::uuid`;
    expect(refund).toEqual({ reason_code: "CANCELLED_HOLD_CAPTURE" });

    // Reverse order: once confirmed, the hold can no longer be abandoned.
    const other = await createUser(sql);
    const second = await heldAndReady(other, { table: 1 });
    const p2 = await services().gateway.simulatePayment(second.order.provider_order_id!, "capture");
    await applyPayment(services(), second.order, p2, "WEBHOOK");
    const confirmed = await bookingOf(other, second.hold.booking_id);
    await expectDomainError(asUser(sql, claimsFor(other), (tx) => cancelHold(tx, second.hold.booking_id, confirmed.version as number)), "INVALID_TRANSITION");
  });

  it("refuses to start checkout on an expired hold", async () => {
    const user = await createUser(sql);
    const hold = await holdTable(sql, user, venue, nextSlot());
    await makeHoldDue(sql, hold.booking_id);
    await expectDomainError(
      startCheckout(services(), claimsFor(user), { bookingId: hold.booking_id, expectedVersion: hold.version }, crypto.randomUUID()),
      "HOLD_EXPIRED"
    );
  });
});

describe("checkout creation under concurrency and provider uncertainty", () => {
  it("creates one payment order and one provider order for ten simultaneous Pay requests", async () => {
    const user = await createUser(sql);
    const hold = await holdTable(sql, user, venue, nextSlot());
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        startCheckout(services(), claimsFor(user), { bookingId: hold.booking_id, expectedVersion: hold.version }, crypto.randomUUID()))
    );
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof startCheckout>>> => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThan(0);
    const orderIds = new Set(fulfilled.map((r) => r.value.order.payment_order_id));
    expect(orderIds.size).toBe(1);
    const [orders] = await sql`select count(*)::int as n from public.payment_orders where booking_id = ${hold.booking_id}::uuid`;
    expect(orders!.n).toBe(1);
    const [row] = await sql`select operation_key from public.payment_orders where booking_id = ${hold.booking_id}::uuid`;
    const [mock] = await sql`select count(*)::int as n from mock_gateway.orders where receipt = ${row!.operation_key as string}`;
    expect(mock!.n).toBe(1);
  });

  it("records UNKNOWN on a timeout and reconciles by receipt without creating a second provider order", async () => {
    const user = await createUser(sql);
    const hold = await holdTable(sql, user, venue, nextSlot());
    const timing = paymentServices(sql, { create_order: "timeout_after_create" });
    const { order } = await startCheckout(timing, claimsFor(user), { bookingId: hold.booking_id, expectedVersion: hold.version }, crypto.randomUUID());
    expect(order).toMatchObject({ state: "UNKNOWN", provider_order_id: null });

    const recovered = await reconcileOrder(services(), order as PaymentOrderRow);
    expect(recovered).toEqual([]);
    const after = await asWorker(sql, (tx) => getPaymentOrder(tx, order.payment_order_id));
    expect(after).toMatchObject({ state: "READY" });
    const [mock] = await sql`select count(*)::int as n from mock_gateway.orders where receipt = ${order.operation_key}`;
    expect(mock!.n).toBe(1);
  });

  it("keeps the hold and reports the provider as unavailable when order creation is refused", async () => {
    const user = await createUser(sql);
    const hold = await holdTable(sql, user, venue, nextSlot());
    const down = paymentServices(sql, { create_order: "unavailable" });
    const { order } = await startCheckout(down, claimsFor(user), { bookingId: hold.booking_id, expectedVersion: hold.version }, crypto.randomUUID());
    expect(order.state).toBe("UNKNOWN");
    const booking = await bookingOf(user, hold.booking_id);
    expect(booking).toMatchObject({ status: "PENDING_PAYMENT", hold_active: true });
    // The next Pay (provider back) reuses the same order.
    const retry = await startCheckout(services(), claimsFor(user), { bookingId: hold.booking_id, expectedVersion: booking.version as number }, crypto.randomUUID());
    expect(retry.order).toMatchObject({ payment_order_id: order.payment_order_id, state: "READY" });
  });
});

describe("ledger and refund invariants", () => {
  it("keeps every journal balanced and rejects an unbalanced one at commit", async () => {
    const unbalanced = await sql`
      select j.id from public.ledger_journals j join public.ledger_entries e on e.journal_id = j.id
      group by j.id having sum(case when e.side = 'DEBIT' then e.amount_paise else -e.amount_paise end) <> 0 or count(*) < 2`;
    expect(unbalanced).toEqual([]);
    await expect(sql.begin(async (tx) => {
      const [j] = await tx`insert into public.ledger_journals (business_key, kind, evidence_ref) values (${`test:${crypto.randomUUID()}`}, 'REFUND_PROCESSED', 'test') returning id`;
      const [acct] = await tx`select id from public.ledger_accounts where code = 'GATEWAY_CLEARING'`;
      await tx`insert into public.ledger_entries (journal_id, account_id, side, amount_paise) values (${j!.id as string}::uuid, ${acct!.id as string}::uuid, 'DEBIT', 100)`;
    })).rejects.toMatchObject({ code: "P0001" });
    const balanced = await sql.begin(async (tx) => {
      const [j] = await tx`insert into public.ledger_journals (business_key, kind, evidence_ref) values (${`test:${crypto.randomUUID()}`}, 'REFUND_PROCESSED', 'test') returning id`;
      const accounts = await tx`select id, code from public.ledger_accounts where code in ('GATEWAY_CLEARING', 'CUSTOMER_REFUND_LIABILITY') order by code`;
      await tx`insert into public.ledger_entries (journal_id, account_id, side, amount_paise) values
               (${j!.id as string}::uuid, ${accounts[0]!.id as string}::uuid, 'DEBIT', 100),
               (${j!.id as string}::uuid, ${accounts[1]!.id as string}::uuid, 'CREDIT', 100)`;
      return j!.id as string;
    });
    await expect(sql`update public.ledger_entries set amount_paise = amount_paise + 1 where journal_id = ${balanced}::uuid`)
      .rejects.toMatchObject({ code: "P0001" });
    await expect(sql`delete from public.ledger_journals where id = ${balanced}::uuid`).rejects.toMatchObject({ code: "P0001" });
  });

  it("never lets non-failed refunds exceed the captured amount", async () => {
    const user = await createUser(sql);
    const { hold, order } = await heldAndReady(user);
    await services().gateway.simulatePayment(order.provider_order_id!, "capture");
    await observeOrderPayments(services(), order, "RECONCILE");
    const [attempt] = await sql`select id, amount_paise from public.payment_attempts where booking_id = ${hold.booking_id}::uuid`;
    await expect(sql`insert into public.refunds (payment_attempt_id, booking_id, amount_paise, reason_code, operation_key)
                     values (${attempt!.id as string}::uuid, ${hold.booking_id}::uuid, ${Number(attempt!.amount_paise) + 1}, 'DUPLICATE_CAPTURE', ${crypto.randomUUID()})`)
      .rejects.toMatchObject({ code: "P0001" });
  });
});

describe("who can read money records", () => {
  it("shows payment rows to their customer and MFA-verified finance only", async () => {
    const [owner, stranger, staff, finance] = [await createUser(sql), await createUser(sql), await createUser(sql), await createUser(sql)];
    await grantVenueRole(sql, venue.venueId, staff, "STAFF");
    await grantPlatformRole(sql, finance, "FINANCE");
    const { hold } = await heldAndReady(owner);
    const read = (user: TestUser, aal: "aal1" | "aal2" = "aal1") =>
      asUser(sql, claimsFor(user, { aal }), (tx) => tx`select id from public.payment_orders where booking_id = ${hold.booking_id}::uuid`);
    expect(await read(owner)).toHaveLength(1);
    expect(await read(stranger)).toHaveLength(0);
    expect(await read(staff, "aal2")).toHaveLength(0);
    expect(await read(finance, "aal1")).toHaveLength(0);
    expect(await read(finance, "aal2")).toHaveLength(1);
    await expect(asUser(sql, claimsFor(owner), (tx) => tx`select operation_key from public.payment_orders`)).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(sql, claimsFor(owner), (tx) => tx`select checkin_pin_hash from public.bookings`)).rejects.toMatchObject({ code: "42501" });
    const ledger = await asUser(sql, claimsFor(owner), (tx) => tx`select id from public.ledger_journals`);
    expect(ledger).toEqual([]);
    await expect(asAnon(sql, (tx) => tx`select id from public.payment_orders`)).rejects.toMatchObject({ code: "42501" });
  });

  it("returns NOT_FOUND for another customer's booking and payment order", async () => {
    const [owner, stranger] = [await createUser(sql), await createUser(sql)];
    const { hold, order } = await heldAndReady(owner);
    await expectDomainError(asUser(sql, claimsFor(stranger), (tx) => customerBooking(tx, hold.booking_id)), "NOT_FOUND");
    await expectDomainError(verifyForCustomer(services(), claimsFor(stranger), order.payment_order_id, {}), "NOT_FOUND");
  });
});
