// M4.4 finance and admin on real PostgreSQL with the local mock gateway (docs/03 A05, P07; docs/05 money tables;
// docs/07 s.4, s.7; docs/08 T17, T18). PROPOSED posting policy (see the migration header): finished bookings earn what
// is left in their customer liability, split by their own price snapshot; admin refunds need finance + TOTP; payouts
// need a second finance person, a matched reconciliation and evidence before PAID.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminApproveFeeConfig, adminCreateFeeConfig, adminFinanceOverview, adminReconciliationRun, adminRefund, adminRefundOptions,
  adminRetryRefund, approvePayoutBatch, asUser, asWorker, cancelBooking, cancelPreview, createPayoutBatch, markPayoutBatch,
  partnerStatement, recognizeEarnings, recordRefundResult, staffCheckIn, staffCheckOut, type Sql
} from "@simply-sit/db";
import { arrivalCodes } from "@simply-sit/domain";
import { applyPayment, runReconciliation, startCheckout, submitRefund } from "@simply-sit/payments";
import {
  claimsFor, createUser, createVenue, expectDomainError, grantPlatformRole, grantVenueRole, holdTable, istSlot, lateWindowSlot,
  nextGridSlot, openDb, paymentServices, type TestUser, type TestVenue
} from "./helpers";

let sql: Sql;
let feeVersion: string;
let staff: TestUser;
let finance: TestUser;
let finance2: TestUser;
let support: TestUser;

const quickPolicy = { increment_minutes: 5, lead_minutes: 0 };
const hours = { weekdays: [0, 1, 2, 3, 4, 5, 6], opens: "04:00", closes: "03:55" };
const tables = (n: number) => Array.from({ length: n }, () => ({ capacity: 4, hourlyPaise: 30000 }));
const services = () => paymentServices(sql);

beforeAll(async () => {
  sql = openDb(20);
  // 15% + Rs 5 per booking: a synthetic, pre-approved configuration for these tests only.
  feeVersion = `TEST-FIN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await sql`insert into public.fee_configurations (config_version, status, commission_bps, platform_fixed_paise, effective_from,
                                                   approved_at, is_synthetic)
            values (${feeVersion}, 'APPROVED', 1500, 500, '2026-01-01T00:00:00Z', now(), true)`;
  [staff, finance, finance2, support] = await Promise.all(Array.from({ length: 4 }, () => createUser(sql)));
  await grantPlatformRole(sql, finance, "FINANCE");
  await grantPlatformRole(sql, finance2, "FINANCE");
  await grantPlatformRole(sql, support, "SUPPORT");
});
afterAll(async () => {
  await sql.end();
});

const as = (user: TestUser, aal: "aal1" | "aal2" = "aal2") => <T>(work: Parameters<typeof asUser<T>>[2]) => asUser(sql, claimsFor(user, { aal }), work);
const tableCursor = new Map<string, number>();

async function financeVenue(opts: { lateRefundBps?: number } = {}): Promise<TestVenue> {
  const venue = await createVenue(sql, {
    tables: tables(12), hours, feeConfigVersion: feeVersion,
    policy: { ...quickPolicy, ...(opts.lateRefundBps === undefined ? {} : { late_refund_bps: opts.lateRefundBps }) }
  });
  await grantVenueRole(sql, venue.venueId, staff, "STAFF");
  return venue;
}

// A paid booking at the venue, starting within minutes (or at `startAt`).
async function paidBooking(venue: TestVenue, startAt = nextGridSlot(5, 1)) {
  const customer = await createUser(sql);
  const table = tableCursor.get(venue.venueId) ?? 0;
  tableCursor.set(venue.venueId, table + 1);
  const hold = await holdTable(sql, customer, venue, startAt, { table });
  const s = services();
  const { order } = await startCheckout(s, claimsFor(customer), { bookingId: hold.booking_id, expectedVersion: hold.version }, crypto.randomUUID());
  const payment = await s.gateway.simulatePayment(order.provider_order_id!, "capture");
  await applyPayment(s, order, payment, "VERIFY");
  return { customer, bookingId: hold.booking_id, publicRef: hold.public_ref, total: hold.quote.price_snapshot.total_paise, order, payment };
}

async function complete(venue: TestVenue, bookingId: string) {
  const codes = arrivalCodes(services().arrivalSecret, bookingId);
  await as(staff)((tx) => staffCheckIn(tx, { venue_id: venue.venueId, qr_token: codes.qrToken, public_ref: null, pin: null }));
  const [row] = await sql`select version from public.bookings where id = ${bookingId}::uuid`;
  await as(staff)((tx) => staffCheckOut(tx, bookingId, row!.version as number));
}

const sweep = () => asWorker(sql, (tx) => recognizeEarnings(tx, 500));
const earning = async (bookingId: string) => (await sql`select * from public.booking_earnings where booking_id = ${bookingId}::uuid`)[0];
const liability = async (bookingId: string) =>
  Number((await sql`select app.booking_liability_balance(${bookingId}::uuid) as v`)[0]!.v);
const payable = async (partnerId: string) => Number((await sql`select app.partner_payable_balance(${partnerId}::uuid) as v`)[0]!.v);
const platformBalance = async (code: string) => Number((await sql`
  select coalesce(sum(case when e.side = 'DEBIT' then e.amount_paise else -e.amount_paise end), 0) as v
  from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id
  where a.partner_id is null and a.code = ${code}`)[0]!.v);
const allJournalsBalance = async () => {
  const rows = await sql`
    select j.id from public.ledger_journals j join public.ledger_entries e on e.journal_id = j.id
    group by j.id having sum(case when e.side = 'DEBIT' then e.amount_paise else -e.amount_paise end) <> 0 or count(*) < 2`;
  expect(rows).toHaveLength(0);
};
const batchVersion = async (batchId: string) =>
  Number((await sql`select version from public.payout_batches where id = ${batchId}::uuid`)[0]!.version);

describe("earnings (docs/05 posting policy)", () => {
  it("recognises a finished booking once, split by its own price snapshot; open bookings wait", async () => {
    const venue = await financeVenue();
    const done = await paidBooking(venue);
    const open = await paidBooking(venue);
    expect(done.total).toBe(30000);
    await complete(venue, done.bookingId);
    // The sweep reads a queue of finished paid bookings, not all history (M5.3).
    const queued = () => sql`select booking_id from public.earning_queue where booking_id in (${done.bookingId}::uuid, ${open.bookingId}::uuid)`;
    expect((await queued()).map((r) => r.booking_id)).toEqual([done.bookingId]);

    expect(await sweep()).toBeGreaterThanOrEqual(1);
    expect(await queued()).toHaveLength(0);
    expect(await earning(done.bookingId)).toMatchObject({
      booking_status: "COMPLETED", gross_paise: 30000, platform_fee_paise: 5000, partner_paise: 25000,
      commission_bps: 1500, fee_config_version: feeVersion
    });
    expect(await earning(open.bookingId)).toBeUndefined();
    expect(await liability(done.bookingId)).toBe(0);
    expect(await liability(open.bookingId)).toBe(30000);
    expect(await payable(venue.partnerId)).toBe(25000);

    // Idempotent: a second sweep (or a concurrent one) never earns the booking twice.
    await Promise.all([sweep(), sweep()]);
    const [{ n }] = (await sql`select count(*)::int as n from public.ledger_journals where business_key = ${"earned:booking:" + done.bookingId}`) as unknown as [{ n: number }];
    expect(n).toBe(1);
    expect(await payable(venue.partnerId)).toBe(25000);
    await allJournalsBalance();
  });

  it("earns only what a late cancellation retained", async () => {
    const venue = await financeVenue({ lateRefundBps: 5000 });
    const b = await paidBooking(venue, lateWindowSlot(30));
    const terms = await as(b.customer, "aal1")((tx) => cancelPreview(tx, b.bookingId)) as { refund_paise: number; version: number };
    expect(terms.refund_paise).toBe(15000);
    const [row] = await sql`select version from public.bookings where id = ${b.bookingId}::uuid`;
    await as(b.customer, "aal1")((tx) => cancelBooking(tx, {
      booking_id: b.bookingId, reason_code: "CHANGE_OF_PLANS", expected_version: row!.version as number, expected_refund_paise: 15000
    }));
    await sweep();
    // 15000 retained: 15% of it (2250) + Rs 5 fixed to the platform.
    expect(await earning(b.bookingId)).toMatchObject({
      booking_status: "CANCELLED", gross_paise: 15000, platform_fee_paise: 2750, partner_paise: 12250
    });
    await allJournalsBalance();
  });
});

describe("admin refunds (A03/A05, T17)", () => {
  it("needs finance + TOTP and a reason; comes out of the booking before it finishes, never above what is refundable", async () => {
    const venue = await financeVenue();
    const b = await paidBooking(venue);
    const input = { booking_id: b.bookingId, amount_paise: 10000, reason: "Goodwill: table was not clean (test)" };

    await expectDomainError(as(support)((tx) => adminRefund(tx, input)), "FORBIDDEN");
    await expectDomainError(as(staff)((tx) => adminRefund(tx, input)), "FORBIDDEN");
    await expectDomainError(as(finance, "aal1")((tx) => adminRefund(tx, input)), "REAUTH_REQUIRED");
    await expectDomainError(as(finance)((tx) => adminRefund(tx, { ...input, reason: "short" })), "VALIDATION_FAILED");

    expect(await as(finance)((tx) => adminRefundOptions(tx, b.bookingId))).toMatchObject({
      needs_charge_to: false, max_refund_paise: 30000, booking_liability_paise: 30000, earned: null
    });
    const first = await as(finance)((tx) => adminRefund(tx, input, crypto.randomUUID()));
    expect(first).toMatchObject({ status: "REQUESTED", charge_to: "BOOKING", amount_paise: 10000 });
    expect(await liability(b.bookingId)).toBe(20000);
    const over = await expectDomainError(as(finance)((tx) => adminRefund(tx, { ...input, amount_paise: 25000 })), "VALIDATION_FAILED");
    expect(over).toMatchObject({ reason: "exceeds_refundable", max_paise: 20000 });

    const [audit] = await sql`select actor_role, reason from public.audit_events
                              where action = 'refund.admin_requested' and entity_id = ${first.refund_id as string}::uuid`;
    expect(audit).toMatchObject({ actor_role: "FINANCE", reason: input.reason });
    const [job] = await sql`select kind from public.outbox_jobs where business_key = ${"refund:" + first.refund_id + ":submit"}`;
    expect(job).toMatchObject({ kind: "refund.submit" });
    expect(await submitRefund(services(), first.refund_id as string)).toBe("PROCESSED");

    // After it finishes, the 20000 left is earned; later refunds are charged to the partner or the platform.
    await complete(venue, b.bookingId);
    const options = await as(finance)((tx) => adminRefundOptions(tx, b.bookingId));
    expect(options).toMatchObject({ needs_charge_to: true, max_refund_paise: 20000 });
    const missing = await expectDomainError(as(finance)((tx) => adminRefund(tx, { ...input, amount_paise: 1000 })), "VALIDATION_FAILED");
    expect(missing).toMatchObject({ field: "charge_to", reason: "required_after_earning" });
    // The refused call rolled back its inline recognition; the sweep earns the 20000 left.
    await sweep();
    expect(await earning(b.bookingId)).toMatchObject({ gross_paise: 20000, partner_paise: 16500, platform_fee_paise: 3500 });

    const expenseBefore = await platformBalance("PLATFORM_ADJUSTMENT_EXPENSE");
    await as(finance)((tx) => adminRefund(tx, { ...input, amount_paise: 5000, charge_to: "PARTNER" }));
    await as(finance)((tx) => adminRefund(tx, { ...input, amount_paise: 3000, charge_to: "PLATFORM" }));
    expect(await payable(venue.partnerId)).toBe(16500 - 5000);
    expect(await platformBalance("PLATFORM_ADJUSTMENT_EXPENSE")).toBe(expenseBefore + 3000);
    // 30000 captured: 10000 + 5000 + 3000 reserved, 12000 left.
    const ceiling = await expectDomainError(
      as(finance)((tx) => adminRefund(tx, { ...input, amount_paise: 12001, charge_to: "PLATFORM" })), "VALIDATION_FAILED");
    expect(ceiling).toMatchObject({ reason: "exceeds_refundable", max_paise: 12000 });
    await allJournalsBalance();
  });

  it("caps a later cancellation refund by what the booking still holds; a replayed request returns the same refund", async () => {
    const venue = await financeVenue();
    const b = await paidBooking(venue, istSlot(2, "12:00"));
    const requestId = crypto.randomUUID();
    const input = { booking_id: b.bookingId, amount_paise: 10000, reason: "Goodwill before the visit (test)" };
    const first = await as(finance)((tx) => adminRefund(tx, input, requestId));
    expect(await as(finance)((tx) => adminRefund(tx, input, requestId))).toMatchObject({ refund_id: first.refund_id, replayed: true });
    const rows = await sql`select requested_by, approved_by from public.refunds where booking_id = ${b.bookingId}::uuid`;
    // One finance person requested it and nobody else approved it, so no approver is recorded.
    expect(rows).toEqual([{ requested_by: finance.profileId, approved_by: null }]);

    // Early cancellation is a 100% refund of the 30000 paid, but only 20000 is still owed.
    const terms = await as(b.customer, "aal1")((tx) => cancelPreview(tx, b.bookingId)) as { refund_paise: number; retained_paise: number };
    expect(terms).toMatchObject({ refund_paise: 20000, retained_paise: 0 });
    const [row] = await sql`select version from public.bookings where id = ${b.bookingId}::uuid`;
    expect(await as(b.customer, "aal1")((tx) => cancelBooking(tx, {
      booking_id: b.bookingId, reason_code: "CHANGE_OF_PLANS", expected_version: row!.version as number, expected_refund_paise: 20000
    }))).toMatchObject({ status: "CANCELLED", refund_paise: 20000 });
    expect(await liability(b.bookingId)).toBe(0);
    await allJournalsBalance();
  });

  it("retries a failed refund once, as the same liability: no new journal and no second charge to the partner", async () => {
    const venue = await financeVenue();
    const b = await paidBooking(venue);
    await complete(venue, b.bookingId);
    await sweep();
    const charged = await as(finance)((tx) => adminRefund(tx, {
      booking_id: b.bookingId, amount_paise: 5000, charge_to: "PARTNER", reason: "Complaint upheld (test)"
    })) as { refund_id: string };
    await asWorker(sql, (tx) => recordRefundResult(tx, charged.refund_id, "FAILED", null, "PROVIDER_REJECTED"));
    // Still owed, so still counted: finance cannot refund the same money again through a new refund.
    expect(await as(finance)((tx) => adminRefundOptions(tx, b.bookingId))).toMatchObject({
      max_refund_paise: 25000, retryable: [expect.objectContaining({ refund_id: charged.refund_id, amount_paise: 5000 })]
    });
    const journals = async () => Number((await sql`select count(*) as n from public.ledger_journals where booking_id = ${b.bookingId}::uuid`)[0]!.n);
    const before = await journals();

    await expectDomainError(as(support)((tx) => adminRetryRefund(tx, charged.refund_id, "Retrying after provider rejection")), "FORBIDDEN");
    await expectDomainError(as(finance)((tx) => adminRetryRefund(tx, charged.refund_id, "short")), "VALIDATION_FAILED");
    const retry = await as(finance)((tx) => adminRetryRefund(tx, charged.refund_id, "Retrying after provider rejection (test)")) as
      { refund_id: string };
    expect(retry).toMatchObject({ retry_of: charged.refund_id, status: "REQUESTED", replayed: false });
    expect(await as(finance)((tx) => adminRetryRefund(tx, charged.refund_id, "Retrying after provider rejection (test)")))
      .toMatchObject({ refund_id: retry.refund_id, replayed: true });
    const [row] = await sql`select reason_code, charge_to, admin_reason from public.refunds where id = ${retry.refund_id}::uuid`;
    expect(row).toEqual({ reason_code: "ADMIN_REFUND", charge_to: null, admin_reason: null });
    expect(await journals()).toBe(before);
    expect(await as(finance)((tx) => adminRefundOptions(tx, b.bookingId))).toMatchObject({ retryable: [] });
    expect(await payable(venue.partnerId)).toBe(25000 - 5000);
    const batch = await as(finance)((tx) => createPayoutBatch(tx, venue.partnerId));
    expect(batch).toMatchObject({ amount_paise: 20000, adjustments_paise: 5000 });

    expect(await submitRefund(services(), retry.refund_id)).toBe("PROCESSED");
    await expectDomainError(as(finance)((tx) => adminRetryRefund(tx, retry.refund_id, "Retrying a processed refund (test)")), "INVALID_TRANSITION");
    await allJournalsBalance();
  });
});

describe("fee versions (A05)", () => {
  it("are future-dated, drafted and approved by two different finance people, then immutable", async () => {
    const version = `TEST-FEE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const input = {
      config_version: version, commission_bps: 1200, platform_fixed_paise: 0, customer_fee_paise: 0,
      effective_from: new Date(Date.now() + 7 * 86_400_000).toISOString()
    };
    await expectDomainError(as(support)((tx) => adminCreateFeeConfig(tx, input)), "FORBIDDEN");
    await expectDomainError(as(finance)((tx) => adminCreateFeeConfig(tx, { ...input, effective_from: new Date(Date.now() - 1000).toISOString() })),
                            "VALIDATION_FAILED");
    const draft = await as(finance)((tx) => adminCreateFeeConfig(tx, input));
    expect(draft).toMatchObject({ status: "DRAFT", created_by_me: true, version: 1 });
    await expectDomainError(as(finance)((tx) => adminCreateFeeConfig(tx, input)), "VALIDATION_FAILED");

    await expectDomainError(as(finance)((tx) => adminApproveFeeConfig(tx, draft.fee_config_id as string, 1)), "SEPARATION_OF_DUTIES");
    await expectDomainError(as(finance2)((tx) => adminApproveFeeConfig(tx, draft.fee_config_id as string, 9)), "STALE_VERSION");
    const approved = await as(finance2)((tx) => adminApproveFeeConfig(tx, draft.fee_config_id as string, 1));
    expect(approved).toMatchObject({ status: "APPROVED", created_by_me: false });
    await expect(sql`update public.fee_configurations set commission_bps = 0 where id = ${draft.fee_config_id as string}::uuid`)
      .rejects.toThrow(/IMMUTABLE_RECORD/);
    const [audit] = await sql`select count(*)::int as n from public.audit_events
                              where entity_id = ${draft.fee_config_id as string}::uuid and action like 'fee_config.%'`;
    expect(audit!.n).toBe(2);
  });
});

describe("reconciliation and payouts (A05, T18)", () => {
  let venue: TestVenue;
  let paid: Awaited<ReturnType<typeof paidBooking>>;
  let injected: Awaited<ReturnType<typeof paidBooking>> | undefined;
  let batchId: string;
  // Only this block's own payments: earlier test files deliberately leave unobserved captures and fabricated provider
  // IDs, which reconciliation rightly reports.
  let windowStart: string;
  beforeAll(() => {
    windowStart = new Date().toISOString();
  });
  const reconcile = (user: TestUser = finance) =>
    runReconciliation(services(), claimsFor(user, { aal: "aal2" }), { from: windowStart, to: new Date().toISOString() }, crypto.randomUUID());

  it("reports a provider capture the platform never recorded, and blocks payout approval until a matched run", async () => {
    venue = await financeVenue();
    paid = await paidBooking(venue);
    await complete(venue, paid.bookingId);

    // The provider captured a payment the platform never observed (lost callback and webhook).
    const customer = await createUser(sql);
    const hold = await holdTable(sql, customer, venue, nextGridSlot(5, 1), { table: 11 });
    const s = services();
    const { order } = await startCheckout(s, claimsFor(customer), { bookingId: hold.booking_id, expectedVersion: hold.version }, crypto.randomUUID());
    const lost = await s.gateway.simulatePayment(order.provider_order_id!, "capture");

    await expectDomainError(runReconciliation(s, claimsFor(support, { aal: "aal2" }), { from: windowStart, to: new Date().toISOString() }), "FORBIDDEN");
    await expectDomainError(runReconciliation(s, claimsFor(finance, { aal: "aal1" }), { from: windowStart, to: new Date().toISOString() }), "REAUTH_REQUIRED");
    const mismatch = await reconcile();
    expect(mismatch).toMatchObject({ status: "MISMATCH" });
    const detail = await as(finance)((tx) => adminReconciliationRun(tx, mismatch.run_id));
    expect(detail.exceptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "MISSING_LOCALLY", object_type: "PAYMENT", provider_ref: lost.providerPaymentId, provider_amount_paise: 30000 })
    ]));
    expect(detail.exceptions).toHaveLength(mismatch.exception_count);

    const draft = await as(finance)((tx) => createPayoutBatch(tx, venue.partnerId, crypto.randomUUID()));
    batchId = draft.payout_batch_id as string;
    expect(draft).toMatchObject({ status: "DRAFT", amount_paise: 25000, earnings_paise: 25000, adjustments_paise: 0, items: 1 });
    await expectDomainError(as(finance)((tx) => createPayoutBatch(tx, venue.partnerId)), "INVALID_TRANSITION");
    await expectDomainError(as(finance)((tx) => approvePayoutBatch(tx, batchId, 1)), "SEPARATION_OF_DUTIES");
    const blocked = await expectDomainError(as(finance2)((tx) => approvePayoutBatch(tx, batchId, 1)), "RECONCILIATION_REQUIRED");
    expect(blocked).toMatchObject({ uncovered: 1, mismatch_run_id: mismatch.run_id });

    // Resolving the exception (the payment is observed and allocated) and re-running unblocks approval.
    await applyPayment(s, order, lost, "RECONCILE");
    injected = { customer, bookingId: hold.booking_id, publicRef: hold.public_ref, total: 30000, order, payment: lost };
    expect(await reconcile()).toMatchObject({ status: "MATCHED", exception_count: 0 });
    const approved = await as(finance2)((tx) => approvePayoutBatch(tx, batchId, 1));
    expect(approved).toMatchObject({ status: "APPROVED" });
  });

  it("marks PAID only with evidence, posting the payout journal; other states release or keep allocations", async () => {
    const version = await batchVersion(batchId);
    const noEvidence = await expectDomainError(
      as(finance)((tx) => markPayoutBatch(tx, batchId, { status: "PAID", expected_version: version })), "VALIDATION_FAILED");
    expect(noEvidence).toMatchObject({ reason: "evidence_required" });
    await expectDomainError(as(finance)((tx) => markPayoutBatch(tx, batchId, { status: "CANCELLED", expected_version: version, reason: "Not needed" })),
                            "INVALID_TRANSITION");
    const processing = await as(finance)((tx) => markPayoutBatch(tx, batchId, { status: "PROCESSING", expected_version: version, reference: "TRF-TEST-0001" }));
    expect(processing).toMatchObject({ status: "PROCESSING", transfer_ref: "TRF-TEST-0001" });
    const paidBatch = await as(finance)((tx) =>
      markPayoutBatch(tx, batchId, { status: "PAID", expected_version: version + 1, reference: "UTR-TEST-0001" }));
    expect(paidBatch).toMatchObject({ status: "PAID", evidence_ref: "UTR-TEST-0001" });
    expect(await payable(venue.partnerId)).toBe(0);
    const [journal] = await sql`select kind, evidence_ref from public.ledger_journals where business_key = ${"payout:" + batchId + ":paid"}`;
    expect(journal).toMatchObject({ kind: "PAYOUT_PAID", evidence_ref: "payout_evidence:UTR-TEST-0001" });
    await expect(sql`update public.payout_batches set status = 'FAILED' where id = ${batchId}::uuid`).rejects.toThrow(/INVALID_TRANSITION|IMMUTABLE_RECORD/);
    await allJournalsBalance();
  });

  it("charges a refund after payout as a negative adjustment, netted from the next payout", async () => {
    await as(finance)((tx) => adminRefund(tx, {
      booking_id: paid.bookingId, amount_paise: 5000, charge_to: "PARTNER", reason: "Customer complaint upheld (test)"
    }));
    expect(await payable(venue.partnerId)).toBe(-5000);
    const nothing = await expectDomainError(as(finance)((tx) => createPayoutBatch(tx, venue.partnerId)), "VALIDATION_FAILED");
    expect(nothing).toMatchObject({ reason: "nothing_payable", net_paise: -5000 });

    // The recovered booking finishes: 25000 earned less the 5000 adjustment.
    await complete(venue, injected!.bookingId);
    const next = await as(finance)((tx) => createPayoutBatch(tx, venue.partnerId));
    expect(next).toMatchObject({ amount_paise: 20000, earnings_paise: 25000, adjustments_paise: 5000, items: 2 });
    expect(await reconcile()).toMatchObject({ status: "MATCHED" });
    const approved = await as(finance2)((tx) => approvePayoutBatch(tx, next.payout_batch_id as string, 1));

    // A failed transfer releases the allocations, so the same money can be drafted again; nothing was paid.
    const failed = await as(finance)((tx) => markPayoutBatch(tx, next.payout_batch_id as string, {
      status: "FAILED", expected_version: approved.version as number, reason: "Bank rejected the account (test)"
    }));
    expect(failed).toMatchObject({ status: "FAILED" });
    const [{ active }] = (await sql`select count(*) filter (where active)::int as active from public.payout_allocations
                                    where batch_id = ${next.payout_batch_id as string}::uuid`) as unknown as [{ active: number }];
    expect(active).toBe(0);
    const again = await as(finance)((tx) => createPayoutBatch(tx, venue.partnerId));
    expect(again).toMatchObject({ amount_paise: 20000, status: "DRAFT" });
    expect(await as(finance2)((tx) => markPayoutBatch(tx, again.payout_batch_id as string, {
      status: "CANCELLED", expected_version: 1, reason: "Wait for month end (test)"
    }))).toMatchObject({ status: "CANCELLED" });
    expect(await payable(venue.partnerId)).toBe(20000);
  });

  it("shows the venue's manager a scoped statement; staff and other venues cannot see it", async () => {
    const owner = await createUser(sql);
    const outsider = await createUser(sql);
    await grantVenueRole(sql, venue.venueId, owner, "OWNER");
    const other = await financeVenue();
    await grantVenueRole(sql, other.venueId, outsider, "MANAGER");
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

    const statement = await as(owner)((tx) => partnerStatement(tx, venue.venueId, yesterday, today));
    expect(statement.role).toBe("OWNER");
    expect(statement.earnings.map((e) => e.public_ref).sort()).toEqual([paid.publicRef, injected!.publicRef].sort());
    expect(statement.earnings.find((e) => e.public_ref === paid.publicRef)).toMatchObject({ payout_status: "PAID", partner_paise: 25000 });
    expect(statement.earnings.find((e) => e.public_ref === injected!.publicRef)).toMatchObject({ payout_status: "UNPAID" });
    expect(statement.adjustments).toEqual([expect.objectContaining({ public_ref: paid.publicRef, amount_paise: 5000, payout_status: "UNPAID" })]);
    expect(statement.payouts).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "PAID", venue_amount_paise: 25000, evidence_ref: "UTR-TEST-0001" }),
      expect.objectContaining({ status: "FAILED", evidence_ref: null })
    ]));
    expect(statement.totals).toMatchObject({ earned_paise: 50000, adjustments_paise: 5000, paid_paise: 25000, unresolved_paise: 20000 });

    await expectDomainError(as(staff)((tx) => partnerStatement(tx, venue.venueId, yesterday, today)), "FORBIDDEN");
    await expectDomainError(as(outsider)((tx) => partnerStatement(tx, venue.venueId, yesterday, today)), "NOT_FOUND");
    await expectDomainError(as(owner, "aal1")((tx) => partnerStatement(tx, venue.venueId, yesterday, today)), "REAUTH_REQUIRED");
    await expectDomainError(as(owner)((tx) => partnerStatement(tx, venue.venueId, "2026-01-01", today)), "VALIDATION_FAILED");
  });

  it("gives finance an overview without exposing it to support", async () => {
    await expectDomainError(as(support)((tx) => adminFinanceOverview(tx)), "FORBIDDEN");
    const overview = await as(finance)((tx) => adminFinanceOverview(tx)) as {
      partners: { partner_id: string; payable_paise: number }[]; payout_batches: { status: string }[]; reconciliation: { status: string }[];
      accounts: { code: string }[];
    };
    expect(overview.partners).toEqual(expect.arrayContaining([expect.objectContaining({ partner_id: venue.partnerId, payable_paise: 20000 })]));
    expect(overview.accounts.map((a) => a.code)).toEqual(expect.arrayContaining(["PLATFORM_FEE_REVENUE", "GATEWAY_CLEARING"]));
    expect(overview.reconciliation[0]).toMatchObject({ status: "MATCHED" });
  });
});

describe("payout reconciliation coverage", () => {
  it("approves a batch longer than one run once matched runs cover every capture; another environment's run does not count", async () => {
    const venue = await financeVenue();
    const old = await paidBooking(venue);
    await complete(venue, old.bookingId);
    // Test-only clock travel: this capture happened 35-365 days ago, at the provider and locally alike. A random point
    // keeps repeated runs on the same database from sharing a reconciliation window.
    const back = `${35 * 24 * 60 + Math.floor(Math.random() * 330 * 24 * 60)} minutes`;
    await sql`update public.payment_attempts set captured_at = captured_at - ${back}::interval where booking_id = ${old.bookingId}::uuid`;
    await sql`update mock_gateway.payments set captured_at = captured_at - ${back}::interval where id = ${old.payment.providerPaymentId}`;
    const recent = await paidBooking(venue);
    await complete(venue, recent.bookingId);
    // Only this test's recent capture: a window around its own timestamp. A window of "the last two minutes" also
    // caught captures written by other test runs, which the local database does not hold, so the run reported MISMATCH.
    const [{ at: recentAt }] = (await sql`select captured_at as at from public.payment_attempts where booking_id = ${recent.bookingId}::uuid`) as unknown as [{ at: Date }];
    const ownWindow = { from: new Date(recentAt.getTime() - 2_000).toISOString(), to: new Date(recentAt.getTime() + 2_000).toISOString() };

    const batch = await as(finance)((tx) => createPayoutBatch(tx, venue.partnerId)) as { payout_batch_id: string };
    expect(await runReconciliation(services(), claimsFor(finance, { aal: "aal2" }), ownWindow))
      .toMatchObject({ status: "MATCHED" });
    expect(await expectDomainError(as(finance2)((tx) => approvePayoutBatch(tx, batch.payout_batch_id, 1)), "RECONCILIATION_REQUIRED"))
      .toMatchObject({ uncovered: 1 });

    const [{ at }] = (await sql`select captured_at as at from public.payment_attempts where booking_id = ${old.bookingId}::uuid`) as unknown as [{ at: Date }];
    const around = { from: new Date(at.getTime() - 3_600_000).toISOString(), to: new Date(at.getTime() + 3_600_000).toISOString() };
    await sql`insert into public.reconciliation_runs (provider, environment, period_from, period_to, status, requested_by, completed_at)
              values ('mock', 'LIVE', ${around.from}::timestamptz, ${around.to}::timestamptz, 'MATCHED', ${finance.profileId}::uuid, now())`;
    await expectDomainError(as(finance2)((tx) => approvePayoutBatch(tx, batch.payout_batch_id, 1)), "RECONCILIATION_REQUIRED");

    expect(await runReconciliation(services(), claimsFor(finance, { aal: "aal2" }), around)).toMatchObject({ status: "MATCHED" });
    expect(await as(finance2)((tx) => approvePayoutBatch(tx, batch.payout_batch_id, 1))).toMatchObject({ status: "APPROVED" });
  });
});
