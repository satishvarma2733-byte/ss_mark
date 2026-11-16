import { checkoutRequestSchema } from "@simply-sit/contracts";
import { startExtensionCheckout } from "@simply-sit/payments";
import { assertSameOrigin, handle, ok, parseBody, parseUuid } from "../../../../../../lib/api";
import { requireUser } from "../../../../../../lib/auth/identity";
import { assertSupportedClient } from "../../../../../../lib/service-status";
import { loadPaymentOrderStatus } from "../../../../../../lib/bookings";
import { getPaymentServices } from "../../../../../../lib/server-env";

export const dynamic = "force-dynamic";

// POST /api/v1/extension-requests/{id}/checkout - the durable payment-order protocol for the incremental amount only,
// bound to the extension. 200 with checkout config once ready; 202 while the provider order is pending. A repeated Pay
// returns the same order. Only a verified capture before the hold deadline applies the extension.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    assertSameOrigin(request, identity.via);
    assertSupportedClient(request);
    const id = parseUuid((await context.params).id);
    const body = await parseBody(request, checkoutRequestSchema);
    const { order } = await startExtensionCheckout(getPaymentServices(), identity.claims, { extensionId: id, expectedVersion: body.expected_version }, requestId);
    const status = await loadPaymentOrderStatus(identity.claims, order.payment_order_id, body.client);
    return ok(requestId, status, status.checkout ? 200 : 202);
  });
}
