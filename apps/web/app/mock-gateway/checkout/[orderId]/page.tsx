import { notFound } from "next/navigation";
import { formatInrPaise } from "../../../../lib/format";
import { mockGatewayOrNotFound, parseReturnTarget } from "../../../../lib/mock-gateway";

export const dynamic = "force-dynamic";

type Params = Promise<{ orderId: string }>;
type Search = Promise<{ ref?: string; return_to?: string }>;

// Stand-in for a provider's hosted checkout. Nothing here can confirm a booking: it only creates a mock payment,
// optionally sends signed webhooks, and redirects back. Simply Sit then fetches the payment itself.
export default async function MockCheckoutPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const gateway = mockGatewayOrNotFound();
  const { orderId } = await params;
  const { ref, return_to } = await searchParams;
  if (!/^order_mock_[A-Za-z0-9]{14}$/.test(orderId) || !ref || !/^[0-9a-f-]{36}$/i.test(ref)) notFound();
  const order = await gateway.fetchOrder(orderId);
  if (!order) notFound();
  const target = parseReturnTarget(return_to);

  return (
    <main className="mock-gateway">
      <p className="mock-gateway-banner" role="note">
        MOCK PAYMENT GATEWAY - TEST MODE - NO MONEY MOVES. This page stands in for a payment provider. Choose an outcome to test.
      </p>
      <h1>Pay Simply Sit (test)</h1>
      <p className="price" data-testid="mock-amount">
        {formatInrPaise(order.amountPaise)}
      </p>
      <p className="food-note">
        Order {order.providerOrderId} · {order.status}
      </p>
      <form method="post" action="/mock-gateway/pay" className="card" style={{ maxWidth: 520 }}>
        <input type="hidden" name="provider_order_id" value={order.providerOrderId} />
        <input type="hidden" name="ref" value={ref} />
        <input type="hidden" name="return_to" value={target} />
        <fieldset>
          <legend>Webhook delivery</legend>
          <label>
            <input type="radio" name="webhook" value="now" defaultChecked /> Send now
          </label>
          <br />
          <label>
            <input type="radio" name="webhook" value="duplicate" /> Send twice (duplicate delivery)
          </label>
          <br />
          <label>
            <input type="radio" name="webhook" value="none" /> Do not send (delayed; use the console later)
          </label>
        </fieldset>
        <p style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button className="button" type="submit" name="outcome" value="capture" data-testid="mock-pay-success">
            Pay (success)
          </button>
          <button className="button secondary" type="submit" name="outcome" value="fail" data-testid="mock-pay-fail">
            Decline payment
          </button>
          <button className="button secondary" type="submit" name="outcome" value="authorize" data-testid="mock-pay-authorize">
            Authorize only (not captured)
          </button>
          <button className="button secondary" type="submit" name="outcome" value="pending" data-testid="mock-pay-pending">
            Leave pending
          </button>
          <button className="button secondary" type="submit" name="outcome" value="cancel" data-testid="mock-pay-cancel">
            Cancel and go back
          </button>
        </p>
      </form>
      <p className="food-note">
        <a href="/mock-gateway/console">Mock gateway console</a> (resend webhooks, capture late, inject faults)
      </p>
    </main>
  );
}
