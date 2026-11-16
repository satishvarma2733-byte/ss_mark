// SERVER-ONLY payment orchestration shared by the web API and the worker (docs/07 s.3, 7, 8).
// Every path that can change payment truth fetches the payment from the gateway itself and hands the provider's
// authoritative state to app.process_payment_observation (worker role). A browser redirect, an app callback or a
// webhook body is only a hint about which payment to fetch. Provider calls never run inside a database transaction.
import {
  asUser, asWorker, beginCheckout, beginExtensionCheckout, beginReconciliation, claimOrderCreation, completeReconciliation,
  customerPaymentOrder, failReconciliation, findPaymentOrder, getProviderEvent, markOrderReconciled, markProviderEvent,
  processPaymentObservation, recordOrderCreationUnknown, recordProviderOrder, recordRefundResult, refundForSubmission,
  refundsToReconcile, type ObservationOutcome, type PaymentOrderRow, type ReconciliationRun, type Sql, type VerifiedClaims
} from "@simply-sit/db";
import { arrivalHashes } from "@simply-sit/domain";
import {
  GatewayUncertainError, GatewayUnavailableError, type CheckoutReturnTarget, type GatewayOrder, type GatewayPayment,
  type PaymentGateway
} from "@simply-sit/providers";

export type PaymentServices = { sql: Sql; gateway: PaymentGateway; arrivalSecret: string };

// Thrown when work must be retried later (provider unavailable, webhook ahead of our order record).
export class RetryLaterError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RetryLaterError";
  }
}

function providerErrorCode(error: unknown): string {
  if (error instanceof GatewayUncertainError) return "PROVIDER_TIMEOUT";
  if (error instanceof GatewayUnavailableError) return "PROVIDER_UNAVAILABLE";
  return "PROVIDER_ERROR";
}

// Makes sure the provider order exists for an order whose creation is pending or uncertain. Reconcile-before-create:
// the provider is searched by our receipt (operation key) first, so a timeout followed by a retry never creates a
// second external order. Concurrent callers are serialised by a short database lease.
export async function ensureProviderOrder(s: PaymentServices, order: PaymentOrderRow): Promise<PaymentOrderRow> {
  if (order.provider_order_id || (order.state !== "ORDER_PENDING" && order.state !== "UNKNOWN")) return order;
  const claim = await asWorker(s.sql, (tx) => claimOrderCreation(tx, order.payment_order_id));
  if (!claim.claimed) return claim;
  let provider: GatewayOrder | null = null;
  try {
    provider = await s.gateway.findOrderByReceipt(order.operation_key);
    provider ??= await s.gateway.createOrder({ amountPaise: order.expected_amount_paise, currency: "INR", receipt: order.operation_key });
  } catch (error) {
    return asWorker(s.sql, (tx) => recordOrderCreationUnknown(tx, order.payment_order_id, providerErrorCode(error)));
  }
  if (provider.amountPaise !== order.expected_amount_paise || provider.currency !== order.currency) {
    // The provider holds an order under our receipt with different money: never use it. Operator review.
    return asWorker(s.sql, (tx) => recordOrderCreationUnknown(tx, order.payment_order_id, "PROVIDER_ORDER_MISMATCH"));
  }
  const providerOrderId = provider.providerOrderId;
  return asWorker(s.sql, (tx) => recordProviderOrder(tx, order.payment_order_id, providerOrderId));
}

// Applies the provider's current state of one payment. The arrival-code hashes are derived here so a confirmation
// can store them in the same transaction; the codes themselves never reach the database.
export async function applyPayment(
  s: PaymentServices,
  order: Pick<PaymentOrderRow, "payment_order_id" | "booking_id" | "provider" | "environment">,
  payment: GatewayPayment,
  source: "VERIFY" | "WEBHOOK" | "RECONCILE",
  providerEventRowId: string | null = null
): Promise<ObservationOutcome> {
  const { tokenHash, pinHash } = arrivalHashes(s.arrivalSecret, order.booking_id);
  return asWorker(s.sql, (tx) =>
    processPaymentObservation(tx, {
      order_id: order.payment_order_id,
      // The gateway's own identity, not the order's: an order from another provider or environment is then rejected
      // by the database instead of being compared with itself (review F4).
      provider: s.gateway.provider,
      environment: s.gateway.environment,
      provider_order_id: payment.providerOrderId,
      provider_payment_id: payment.providerPaymentId,
      amount_paise: payment.amountPaise,
      currency: payment.currency,
      state: payment.state,
      captured_at: payment.capturedAt,
      source,
      provider_event_row_id: providerEventRowId,
      token_hash: tokenHash,
      pin_hash: pinHash
    })
  );
}

// Fetches every payment of the order from the provider and applies each one (failed and captured attempts stay
// separate records). Captures beyond the one allocated become refund liabilities inside the database.
export async function observeOrderPayments(
  s: PaymentServices,
  order: PaymentOrderRow,
  source: "VERIFY" | "RECONCILE"
): Promise<ObservationOutcome[]> {
  if (!order.provider_order_id) return [];
  const payments = await s.gateway.listOrderPayments(order.provider_order_id);
  const outcomes: ObservationOutcome[] = [];
  for (const payment of payments) outcomes.push(await applyPayment(s, order, payment, source));
  return outcomes;
}

// POST /bookings/{id}/checkout. Persists the expected payment (and HOLD -> PENDING_PAYMENT) before any provider call,
// then makes sure the provider order exists. A repeated Pay returns the same order.
export async function startCheckout(
  s: PaymentServices,
  claims: VerifiedClaims,
  input: { bookingId: string; expectedVersion: number },
  requestId: string
) {
  const begun = await asUser(s.sql, claims, (tx) =>
    beginCheckout(
      tx,
      { booking_id: input.bookingId, expected_version: input.expectedVersion, provider: s.gateway.provider, environment: s.gateway.environment },
      requestId
    )
  );
  const order = await ensureProviderOrder(s, begun);
  return { begun, order };
}

// POST /extension-requests/{id}/checkout. Same protocol as a booking checkout, for the extension's incremental amount;
// a repeated Pay returns the same order. The hold deadline never moves.
export async function startExtensionCheckout(
  s: PaymentServices,
  claims: VerifiedClaims,
  input: { extensionId: string; expectedVersion: number },
  requestId: string
) {
  const begun = await asUser(s.sql, claims, (tx) =>
    beginExtensionCheckout(
      tx,
      { extension_id: input.extensionId, expected_version: input.expectedVersion, provider: s.gateway.provider, environment: s.gateway.environment },
      requestId
    )
  );
  const order = await ensureProviderOrder(s, begun);
  return { begun, order };
}

export function checkoutConfig(s: PaymentServices, order: PaymentOrderRow, returnTo: CheckoutReturnTarget) {
  if (order.state !== "READY" || !order.provider_order_id) return null;
  return {
    mode: "mock" as const,
    provider: "mock" as const,
    environment: "TEST" as const,
    key_id: s.gateway.keyId,
    provider_order_id: order.provider_order_id,
    amount_paise: order.expected_amount_paise,
    currency: "INR" as const,
    checkout_url: s.gateway.checkoutUrl({ providerOrderId: order.provider_order_id, paymentOrderId: order.payment_order_id, returnTo })
  };
}

// POST /payment-orders/{id}/verify. Ownership is checked first (another customer's order is NOT_FOUND). The callback
// signature is checked for the record, but confirmation comes only from the provider fetch below.
export async function verifyForCustomer(
  s: PaymentServices,
  claims: VerifiedClaims,
  orderId: string,
  hint: { provider_payment_id?: string | undefined; signature?: string | undefined }
) {
  const current = await asUser(s.sql, claims, (tx) => customerPaymentOrder(tx, orderId));
  let callbackSignature: "valid" | "invalid" | "absent" = "absent";
  if (hint.provider_payment_id && hint.signature && current.provider_order_id) {
    callbackSignature = s.gateway.verifyCheckoutSignature({
      providerOrderId: current.provider_order_id,
      providerPaymentId: hint.provider_payment_id,
      signature: hint.signature
    })
      ? "valid"
      : "invalid";
  }
  // A paid or finished booking with nothing in flight cannot change from the customer's side: skip the provider call
  // (review F5). Expired or cancelled holds are still checked, because a late capture there means a refund is owed.
  const booking = current.booking as {
    status?: string; payment?: { open_attempts?: number } | null; extension?: { extension_id: string; status: string } | null;
  };
  // An extension payment is settled only once that extension is applied: an expired or cancelled extension may still
  // receive a late capture, which is refund liability, so it is still checked.
  const settled = current.extension_id
    ? booking.extension?.extension_id === current.extension_id && booking.extension.status === "APPLIED"
    : ["CONFIRMED", "CHECKED_IN", "COMPLETED", "NO_SHOW"].includes(booking.status ?? "") && (booking.payment?.open_attempts ?? 0) === 0;
  let providerReachable = true;
  try {
    let order: PaymentOrderRow = current;
    if (!settled && !order.provider_order_id && (order.state === "ORDER_PENDING" || order.state === "UNKNOWN")) {
      // Recovery only: look the order up by receipt; never create one from a verify call.
      const found = await s.gateway.findOrderByReceipt(order.operation_key);
      if (found && found.amountPaise === order.expected_amount_paise && found.currency === order.currency) {
        order = await asWorker(s.sql, (tx) => recordProviderOrder(tx, current.payment_order_id, found.providerOrderId));
      }
    }
    if (!settled) await observeOrderPayments(s, order, "VERIFY");
  } catch (error) {
    if (!(error instanceof GatewayUnavailableError || error instanceof GatewayUncertainError)) throw error;
    providerReachable = false;
  }
  const after = await asUser(s.sql, claims, (tx) => customerPaymentOrder(tx, orderId));
  return { order: after, callbackSignature, providerReachable };
}

// Worker: one stored webhook. The body named a payment; its state is fetched from the provider, and our order is found
// from the provider's own order reference. Unknown orders are retried (the webhook can beat our order record) and
// quarantined on the final attempt.
export async function processProviderEvent(
  s: PaymentServices,
  eventRowId: string,
  finalAttempt: boolean
): Promise<"PROCESSED" | "QUARANTINED"> {
  const event = await asWorker(s.sql, (tx) => getProviderEvent(tx, eventRowId));
  if (!event || event.status === "PROCESSED") return "PROCESSED";
  const quarantine = async (code: string) => {
    await asWorker(s.sql, (tx) => markProviderEvent(tx, eventRowId, "QUARANTINED", code));
    return "QUARANTINED" as const;
  };
  const paymentId = event.safe_payload.provider_payment_id;
  if (typeof paymentId !== "string") return quarantine("NO_PAYMENT_REFERENCE");

  let payment: GatewayPayment | null;
  try {
    payment = await s.gateway.fetchPayment(paymentId);
  } catch (error) {
    await asWorker(s.sql, (tx) => markProviderEvent(tx, eventRowId, "RETRY", providerErrorCode(error)));
    throw new RetryLaterError(providerErrorCode(error));
  }
  if (!payment) return quarantine("UNKNOWN_PAYMENT");
  const providerOrderId = payment.providerOrderId;
  const order = await asWorker(s.sql, (tx) => findPaymentOrder(tx, s.gateway.provider, s.gateway.environment, providerOrderId));
  if (!order) {
    if (finalAttempt) return quarantine("UNKNOWN_ORDER");
    await asWorker(s.sql, (tx) => markProviderEvent(tx, eventRowId, "RETRY", "UNKNOWN_ORDER"));
    throw new RetryLaterError("UNKNOWN_ORDER");
  }
  const outcome = await applyPayment(s, order, payment, "WEBHOOK", eventRowId);
  if (outcome.outcome === "MISMATCHED_ORDER") return quarantine("MISMATCHED_ORDER");
  await asWorker(s.sql, (tx) => markProviderEvent(tx, eventRowId, "PROCESSED"));
  return "PROCESSED";
}

// Worker: missing/delayed webhooks and uncertain creations are found by asking the provider (docs/07 s.8).
export async function reconcileOrder(s: PaymentServices, order: PaymentOrderRow): Promise<ObservationOutcome[]> {
  let current = order;
  if (!current.provider_order_id) {
    if (current.state === "EXPIRED") {
      const found = await s.gateway.findOrderByReceipt(current.operation_key);
      if (found) current = await asWorker(s.sql, (tx) => recordProviderOrder(tx, order.payment_order_id, found.providerOrderId));
    } else {
      current = await ensureProviderOrder(s, current);
    }
  }
  const outcomes = await observeOrderPayments(s, current, "RECONCILE");
  await asWorker(s.sql, (tx) => markOrderReconciled(tx, order.payment_order_id));
  return outcomes;
}

// Worker: submits a refund liability. The refund's operation key is the provider idempotency key, so a retry after a
// timeout or crash returns the original refund instead of paying twice. PROCESSED needs the provider's refund ID.
export async function submitRefund(s: PaymentServices, refundId: string): Promise<string> {
  const refund = await asWorker(s.sql, (tx) => refundForSubmission(tx, refundId));
  if (!refund) return "MISSING";
  if (refund.status === "PROCESSED" || refund.status === "FAILED") return refund.status;
  try {
    const result = await s.gateway.createRefund({
      providerPaymentId: refund.provider_payment_id,
      amountPaise: refund.amount_paise,
      idempotencyKey: refund.operation_key
    });
    const status = result.state === "PROCESSED" ? "PROCESSED" : result.state === "FAILED" ? "FAILED" : "PROCESSING";
    await asWorker(s.sql, (tx) => recordRefundResult(tx, refundId, status, result.providerRefundId));
    if (status === "PROCESSING") throw new RetryLaterError("REFUND_PROCESSING");
    return status;
  } catch (error) {
    if (error instanceof RetryLaterError) throw error;
    if (error instanceof GatewayUncertainError) {
      await asWorker(s.sql, (tx) => recordRefundResult(tx, refundId, "UNKNOWN", null, "PROVIDER_TIMEOUT"));
      throw new RetryLaterError("PROVIDER_TIMEOUT");
    }
    if (error instanceof GatewayUnavailableError) throw new RetryLaterError("PROVIDER_UNAVAILABLE");
    throw error;
  }
}

// Worker: refunds whose submission stalled (job dead, or provider still pending/unknown) are re-submitted with the same
// operation key; a provider that already refunded returns that refund instead of paying again (review F2).
export async function reconcileRefunds(s: PaymentServices, limit = 20): Promise<{ checked: number; processed: number }> {
  const ids = await asWorker(s.sql, (tx) => refundsToReconcile(tx, limit));
  let processed = 0;
  for (const id of ids) {
    try {
      if ((await submitRefund(s, id)) === "PROCESSED") processed += 1;
    } catch (error) {
      if (!(error instanceof RetryLaterError)) throw error;
    }
  }
  return { checked: ids.length, processed };
}

// Provider listings are padded so a record whose provider and local timestamps fall either side of the period edge is
// still found; the database compares only records inside the period.
const RECONCILIATION_PAD_MS = 60 * 60_000;

// Finance: reconciles provider captures and refunds for a period against local records and the ledger. The run is
// started as the finance user (permission, audit); the provider's records are fetched here, server-side, and the
// comparison is completed as the worker role, so a client never supplies provider evidence.
export async function runReconciliation(
  s: PaymentServices,
  claims: VerifiedClaims,
  period: { from: string; to: string },
  requestId: string | null = null
): Promise<ReconciliationRun> {
  const run = await asUser(s.sql, claims, (tx) =>
    beginReconciliation(tx, { ...period, provider: s.gateway.provider, environment: s.gateway.environment }, requestId));
  const padded = {
    from: new Date(Date.parse(run.period_from) - RECONCILIATION_PAD_MS).toISOString(),
    to: new Date(Date.parse(run.period_to) + RECONCILIATION_PAD_MS).toISOString()
  };
  try {
    const [captures, refunds] = await Promise.all([s.gateway.listCaptures(padded), s.gateway.listRefunds(padded)]);
    return await asWorker(s.sql, (tx) => completeReconciliation(
      tx,
      run.run_id,
      captures.filter((p) => p.capturedAt !== null).map((p) => ({
        provider_payment_id: p.providerPaymentId, amount_paise: p.amountPaise, captured_at: p.capturedAt!
      })),
      refunds.map((r) => ({
        provider_refund_id: r.providerRefundId, provider_payment_id: r.providerPaymentId, amount_paise: r.amountPaise,
        state: r.state, created_at: r.createdAt
      }))));
  } catch (error) {
    await asWorker(s.sql, (tx) => failReconciliation(tx, run.run_id, providerErrorCode(error)));
    if (error instanceof GatewayUnavailableError || error instanceof GatewayUncertainError) throw new RetryLaterError(providerErrorCode(error));
    throw error;
  }
}
