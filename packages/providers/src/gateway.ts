// Payment gateway adapter contract (docs/02 s.6, docs/07 s.3/7). SERVER-ONLY.
// The application never trusts a client for payment truth: it creates orders, fetches payments and verifies webhook
// signatures through this interface. Razorpay is the candidate provider (decision D04); until an owner account exists
// only the local MockGateway implements it, and every surface labels it as a mock.

export type GatewayEnvironment = "TEST" | "LIVE";

export type GatewayOrder = {
  providerOrderId: string;
  amountPaise: number;
  currency: string;
  receipt: string;
  status: "created" | "attempted" | "paid";
};

// The provider's own payment state for one payment ID. A payment is never the same thing as its order.
export type GatewayPaymentState = "PENDING" | "AUTHORIZED" | "CAPTURED" | "FAILED";

export type GatewayPayment = {
  providerPaymentId: string;
  providerOrderId: string;
  amountPaise: number;
  currency: string;
  state: GatewayPaymentState;
  capturedAt: string | null;
};

export type GatewayRefund = {
  providerRefundId: string;
  providerPaymentId: string;
  amountPaise: number;
  state: "PROCESSED" | "PENDING" | "FAILED";
};

export type GatewayRefundRecord = GatewayRefund & { createdAt: string };

// The outcome is unknown (timeout, dropped connection). Never treat as success or failure; reconcile first.
export class GatewayUncertainError extends Error {
  readonly code = "PROVIDER_TIMEOUT";
  constructor(message = "Payment provider outcome unknown") {
    super(message);
    this.name = "GatewayUncertainError";
  }
}

// The provider definitely did not perform the operation (refused before acting). Safe to retry later.
export class GatewayUnavailableError extends Error {
  readonly code = "PROVIDER_UNAVAILABLE";
  constructor(message = "Payment provider unavailable") {
    super(message);
    this.name = "GatewayUnavailableError";
  }
}

export type CheckoutReturnTarget = "web" | "native-dev" | "native-preview";

export interface PaymentGateway {
  readonly provider: "mock";
  readonly environment: GatewayEnvironment;
  readonly keyId: string;
  // Idempotent by receipt (our operation key): a retry after an uncertain outcome returns the same order.
  createOrder(input: { amountPaise: number; currency: "INR"; receipt: string }): Promise<GatewayOrder>;
  // Used to reconcile an uncertain creation before ever creating again.
  findOrderByReceipt(receipt: string): Promise<GatewayOrder | null>;
  listOrderPayments(providerOrderId: string): Promise<GatewayPayment[]>;
  fetchPayment(providerPaymentId: string): Promise<GatewayPayment | null>;
  // Idempotent by key: a retry with the same key and body returns the original refund.
  createRefund(input: { providerPaymentId: string; amountPaise: number; idempotencyKey: string }): Promise<GatewayRefund>;
  // Settlement-style listings for reconciliation: payments captured, and refunds created, in [from, to).
  listCaptures(input: { from: string; to: string }): Promise<GatewayPayment[]>;
  listRefunds(input: { from: string; to: string }): Promise<GatewayRefundRecord[]>;
  verifyCheckoutSignature(input: { providerOrderId: string; providerPaymentId: string; signature: string }): boolean;
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean;
  checkoutUrl(input: { providerOrderId: string; paymentOrderId: string; returnTo: CheckoutReturnTarget }): string;
}
