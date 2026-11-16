// LOCAL MOCK PAYMENT GATEWAY. Moves no money. Development and tests only.
// Behaves like a hosted checkout provider (Razorpay-shaped orders/payments/refunds, signed checkout callback and
// signed, possibly duplicated or delayed webhooks) so the application's verification paths can be exercised end to
// end. State lives in the `mock_gateway` schema that supabase/seed.sql creates in the LOCAL database only; it is never
// part of a migration. Construction refuses a non-local database URL.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type postgres from "postgres";
import {
  GatewayUncertainError,
  GatewayUnavailableError,
  type CheckoutReturnTarget,
  type GatewayOrder,
  type GatewayPayment,
  type GatewayPaymentState,
  type GatewayRefund,
  type GatewayRefundRecord,
  type PaymentGateway
} from "./gateway";

type Sql = postgres.Sql;

export type MockGatewayConfig = {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  // Public origin of the web app, which hosts the mock checkout page and receives webhooks.
  appUrl: string;
};

// Fault injection for tests and the tester console. Read per call from mock_gateway.settings unless overridden.
export type MockGatewayFaults = {
  create_order?: "unavailable" | "timeout_before_create" | "timeout_after_create";
  fetch?: "unavailable";
  create_refund?: "unavailable" | "timeout_after_create";
};

export type SimulatedOutcome = "capture" | "fail" | "authorize" | "pending";

export type WebhookEvent = { eventId: string; eventType: string; body: string; signature: string };

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function randomId(prefix: string): string {
  const bytes = randomBytes(14);
  let out = "";
  for (const byte of bytes) out += ID_ALPHABET[byte % ID_ALPHABET.length];
  return `${prefix}_${out}`;
}

function hmacHex(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

type OrderRow = { id: string; amount_paise: number; currency: string; receipt: string; status: GatewayOrder["status"] };
type PaymentRow = {
  id: string; order_id: string; amount_paise: number; currency: string; status: GatewayPaymentState; captured_at: Date | null;
};

const toOrder = (row: OrderRow): GatewayOrder => ({
  providerOrderId: row.id, amountPaise: Number(row.amount_paise), currency: row.currency, receipt: row.receipt, status: row.status
});
const toPayment = (row: PaymentRow): GatewayPayment => ({
  providerPaymentId: row.id,
  providerOrderId: row.order_id,
  amountPaise: Number(row.amount_paise),
  currency: row.currency,
  state: row.status,
  capturedAt: row.captured_at ? new Date(row.captured_at).toISOString() : null
});

export const RETURN_TARGETS: Record<CheckoutReturnTarget, (appUrl: string) => string> = {
  web: (appUrl) => `${appUrl}/payment/return`,
  "native-dev": () => "simplysit-dev://payment-return",
  "native-preview": () => "simplysit-preview://payment-return"
};

export function assertLocalDatabase(databaseUrl: string | undefined) {
  if (!databaseUrl) throw new Error("Mock gateway needs DATABASE_URL (local stack)");
  const host = new URL(databaseUrl).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("Mock gateway runs only against a LOCAL database");
}

export class MockGateway implements PaymentGateway {
  readonly provider = "mock" as const;
  readonly environment = "TEST" as const;

  constructor(
    private readonly sql: Sql,
    private readonly config: MockGatewayConfig,
    private readonly faultOverride?: MockGatewayFaults
  ) {
    for (const [name, value] of Object.entries({ keySecret: config.keySecret, webhookSecret: config.webhookSecret })) {
      if (!value || value.length < 32) throw new Error(`Mock gateway ${name} must be at least 32 characters`);
    }
  }

  get keyId(): string {
    return this.config.keyId;
  }

  private async faults(): Promise<MockGatewayFaults> {
    if (this.faultOverride) return this.faultOverride;
    const rows = await this.sql`select faults from mock_gateway.settings where id = 1`;
    return (rows[0]?.faults as MockGatewayFaults | undefined) ?? {};
  }

  async setFaults(faults: MockGatewayFaults): Promise<void> {
    await this.sql`insert into mock_gateway.settings (id, faults) values (1, ${this.sql.json(faults)})
                   on conflict (id) do update set faults = excluded.faults`;
  }

  async createOrder(input: { amountPaise: number; currency: "INR"; receipt: string }): Promise<GatewayOrder> {
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) throw new Error("Order amount must be positive paise");
    const fault = (await this.faults()).create_order;
    if (fault === "unavailable") throw new GatewayUnavailableError();
    if (fault === "timeout_before_create") throw new GatewayUncertainError();
    const [row] = await this.sql<OrderRow[]>`
      insert into mock_gateway.orders (id, amount_paise, currency, receipt)
      values (${randomId("order_mock")}, ${input.amountPaise}, ${input.currency}, ${input.receipt})
      on conflict (receipt) do update set receipt = excluded.receipt
      returning id, amount_paise, currency, receipt, status`;
    if (Number(row!.amount_paise) !== input.amountPaise) throw new Error("Mock order receipt reused with a different amount");
    if (fault === "timeout_after_create") throw new GatewayUncertainError();
    return toOrder(row!);
  }

  async findOrderByReceipt(receipt: string): Promise<GatewayOrder | null> {
    if ((await this.faults()).fetch === "unavailable") throw new GatewayUnavailableError();
    const [row] = await this.sql<OrderRow[]>`
      select id, amount_paise, currency, receipt, status from mock_gateway.orders where receipt = ${receipt}`;
    return row ? toOrder(row) : null;
  }

  async fetchOrder(providerOrderId: string): Promise<GatewayOrder | null> {
    const [row] = await this.sql<OrderRow[]>`
      select id, amount_paise, currency, receipt, status from mock_gateway.orders where id = ${providerOrderId}`;
    return row ? toOrder(row) : null;
  }

  async listOrderPayments(providerOrderId: string): Promise<GatewayPayment[]> {
    if ((await this.faults()).fetch === "unavailable") throw new GatewayUnavailableError();
    const rows = await this.sql<PaymentRow[]>`
      select id, order_id, amount_paise, currency, status, captured_at from mock_gateway.payments
      where order_id = ${providerOrderId} order by created_at, id`;
    return rows.map(toPayment);
  }

  async fetchPayment(providerPaymentId: string): Promise<GatewayPayment | null> {
    if ((await this.faults()).fetch === "unavailable") throw new GatewayUnavailableError();
    const [row] = await this.sql<PaymentRow[]>`
      select id, order_id, amount_paise, currency, status, captured_at from mock_gateway.payments where id = ${providerPaymentId}`;
    return row ? toPayment(row) : null;
  }

  async createRefund(input: { providerPaymentId: string; amountPaise: number; idempotencyKey: string }): Promise<GatewayRefund> {
    const fault = (await this.faults()).create_refund;
    if (fault === "unavailable") throw new GatewayUnavailableError();
    const result = await this.sql.begin(async (tx) => {
      const [existing] = await tx`select id, payment_id, amount_paise, status from mock_gateway.refunds
                                  where idempotency_key = ${input.idempotencyKey}`;
      if (existing) {
        if (existing.payment_id !== input.providerPaymentId || Number(existing.amount_paise) !== input.amountPaise) {
          throw new Error("Mock refund idempotency key reused with a different body");
        }
        return existing;
      }
      const [payment] = await tx`select amount_paise, status from mock_gateway.payments where id = ${input.providerPaymentId} for update`;
      if (!payment || payment.status !== "CAPTURED") throw new Error("Mock refund needs a captured payment");
      const [{ refunded }] = (await tx`select coalesce(sum(amount_paise), 0)::bigint as refunded from mock_gateway.refunds
                                        where payment_id = ${input.providerPaymentId}`) as unknown as [{ refunded: number }];
      if (Number(refunded) + input.amountPaise > Number(payment.amount_paise)) throw new Error("Mock refund exceeds captured amount");
      const [row] = await tx`insert into mock_gateway.refunds (id, payment_id, amount_paise, idempotency_key)
                             values (${randomId("rfnd_mock")}, ${input.providerPaymentId}, ${input.amountPaise}, ${input.idempotencyKey})
                             returning id, payment_id, amount_paise, status`;
      return row!;
    });
    if (fault === "timeout_after_create") throw new GatewayUncertainError();
    return {
      providerRefundId: result.id as string,
      providerPaymentId: result.payment_id as string,
      amountPaise: Number(result.amount_paise),
      state: result.status as GatewayRefund["state"]
    };
  }

  async listCaptures(input: { from: string; to: string }): Promise<GatewayPayment[]> {
    if ((await this.faults()).fetch === "unavailable") throw new GatewayUnavailableError();
    const rows = await this.sql<PaymentRow[]>`
      select id, order_id, amount_paise, currency, status, captured_at from mock_gateway.payments
      where status = 'CAPTURED' and captured_at >= ${input.from}::timestamptz and captured_at < ${input.to}::timestamptz
      order by captured_at, id`;
    return rows.map(toPayment);
  }

  async listRefunds(input: { from: string; to: string }): Promise<GatewayRefundRecord[]> {
    if ((await this.faults()).fetch === "unavailable") throw new GatewayUnavailableError();
    const rows = await this.sql`
      select id, payment_id, amount_paise, status, created_at from mock_gateway.refunds
      where created_at >= ${input.from}::timestamptz and created_at < ${input.to}::timestamptz
      order by created_at, id`;
    return rows.map((row) => ({
      providerRefundId: row.id as string,
      providerPaymentId: row.payment_id as string,
      amountPaise: Number(row.amount_paise),
      state: row.status as GatewayRefund["state"],
      createdAt: new Date(row.created_at as Date).toISOString()
    }));
  }

  checkoutSignature(providerOrderId: string, providerPaymentId: string): string {
    return hmacHex(this.config.keySecret, `${providerOrderId}|${providerPaymentId}`);
  }

  verifyCheckoutSignature(input: { providerOrderId: string; providerPaymentId: string; signature: string }): boolean {
    return safeEqualHex(this.checkoutSignature(input.providerOrderId, input.providerPaymentId), input.signature);
  }

  webhookSignature(rawBody: string): string {
    return hmacHex(this.config.webhookSecret, rawBody);
  }

  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    return typeof signature === "string" && safeEqualHex(this.webhookSignature(rawBody), signature);
  }

  checkoutUrl(input: { providerOrderId: string; paymentOrderId: string; returnTo: CheckoutReturnTarget }): string {
    const url = new URL(`/mock-gateway/checkout/${encodeURIComponent(input.providerOrderId)}`, this.config.appUrl);
    url.searchParams.set("ref", input.paymentOrderId);
    url.searchParams.set("return_to", input.returnTo);
    return url.toString();
  }

  returnUrl(target: CheckoutReturnTarget): string {
    return RETURN_TARGETS[target](this.config.appUrl.replace(/\/$/, ""));
  }

  // Tester actions: what a customer or the provider would do. Not part of PaymentGateway. ---------------------------

  async simulatePayment(
    providerOrderId: string,
    outcome: SimulatedOutcome,
    options: { amountPaise?: number; currency?: string } = {}
  ): Promise<GatewayPayment> {
    const order = await this.fetchOrder(providerOrderId);
    if (!order) throw new Error("Unknown mock order");
    const state: GatewayPaymentState =
      outcome === "capture" ? "CAPTURED" : outcome === "fail" ? "FAILED" : outcome === "authorize" ? "AUTHORIZED" : "PENDING";
    const [row] = await this.sql<PaymentRow[]>`
      insert into mock_gateway.payments (id, order_id, amount_paise, currency, status, captured_at)
      values (${randomId("pay_mock")}, ${order.providerOrderId}, ${options.amountPaise ?? order.amountPaise},
              ${options.currency ?? order.currency}, ${state}, ${state === "CAPTURED" ? new Date() : null})
      returning id, order_id, amount_paise, currency, status, captured_at`;
    await this.sql`update mock_gateway.orders set status = ${state === "CAPTURED" ? "paid" : "attempted"}
                   where id = ${order.providerOrderId} and status <> 'paid'`;
    return toPayment(row!);
  }

  // Late capture of an authorized or pending payment (provider-side settlement after the customer left).
  async capturePayment(providerPaymentId: string): Promise<GatewayPayment> {
    const [row] = await this.sql<PaymentRow[]>`
      update mock_gateway.payments set status = 'CAPTURED', captured_at = now()
      where id = ${providerPaymentId} and status in ('AUTHORIZED', 'PENDING')
      returning id, order_id, amount_paise, currency, status, captured_at`;
    if (!row) throw new Error("Mock payment is not capturable");
    await this.sql`update mock_gateway.orders set status = 'paid' where id = ${row.order_id}`;
    return toPayment(row);
  }

  async failPayment(providerPaymentId: string): Promise<GatewayPayment> {
    const [row] = await this.sql<PaymentRow[]>`
      update mock_gateway.payments set status = 'FAILED'
      where id = ${providerPaymentId} and status in ('AUTHORIZED', 'PENDING')
      returning id, order_id, amount_paise, currency, status, captured_at`;
    if (!row) throw new Error("Mock payment cannot fail from its current state");
    return toPayment(row);
  }

  // Builds a signed Razorpay-shaped event. Stored so the console can resend it (duplicates keep the same event ID).
  async buildWebhook(payment: GatewayPayment, eventType?: string): Promise<WebhookEvent> {
    const type = eventType ?? {
      CAPTURED: "payment.captured", FAILED: "payment.failed", AUTHORIZED: "payment.authorized", PENDING: "payment.pending"
    }[payment.state];
    const eventId = randomId("evt_mock");
    const body = JSON.stringify({
      id: eventId,
      entity: "event",
      event: type,
      created_at: Math.floor(Date.now() / 1000),
      payload: {
        payment: {
          entity: {
            id: payment.providerPaymentId,
            order_id: payment.providerOrderId,
            amount: payment.amountPaise,
            currency: payment.currency,
            status: payment.state.toLowerCase()
          }
        }
      }
    });
    await this.sql`insert into mock_gateway.webhook_events (id, payment_id, event_type, body)
                   values (${eventId}, ${payment.providerPaymentId}, ${type}, ${body})`;
    return { eventId, eventType: type, body, signature: this.webhookSignature(body) };
  }

  async storedWebhook(eventId: string): Promise<WebhookEvent | null> {
    const [row] = await this.sql`select id, event_type, body from mock_gateway.webhook_events where id = ${eventId}`;
    if (!row) return null;
    return { eventId: row.id as string, eventType: row.event_type as string, body: row.body as string, signature: this.webhookSignature(row.body as string) };
  }

  // POSTs the event to the application's webhook endpoint, like the provider would. Returns the HTTP status.
  async deliverWebhook(event: WebhookEvent, url = `${this.config.appUrl.replace(/\/$/, "")}/api/v1/webhooks/mock`): Promise<number> {
    let status = 0;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-mock-signature": event.signature, "x-mock-event-id": event.eventId },
        body: event.body
      });
      status = response.status;
    } finally {
      await this.sql`update mock_gateway.webhook_events set deliveries = deliveries + 1, last_http_status = ${status || null}
                     where id = ${event.eventId}`;
    }
    return status;
  }

  async recentPayments(limit = 30) {
    return this.sql`
      select p.id, p.order_id, p.amount_paise, p.currency, p.status, p.created_at, o.receipt,
             (select json_agg(json_build_object('id', w.id, 'event_type', w.event_type, 'deliveries', w.deliveries,
                                                'last_http_status', w.last_http_status) order by w.created_at)
                from mock_gateway.webhook_events w where w.payment_id = p.id) as webhooks
      from mock_gateway.payments p join mock_gateway.orders o on o.id = p.order_id
      order by p.created_at desc limit ${limit}`;
  }
}
