import { checkoutRequestSchema } from "@simply-sit/contracts";
import { startCheckout } from "@simply-sit/payments";
import { assertSameOrigin, handle, ok, parseBody, parseUuid } from "../../../../../../lib/api";
import { requireUser } from "../../../../../../lib/auth/identity";
import { assertSupportedClient } from "../../../../../../lib/service-status";
import { loadPaymentOrderStatus } from "../../../../../../lib/bookings";
import { getPaymentServices } from "../../../../../../lib/server-env";

export const dynamic = "force-dynamic";

// POST /api/v1/bookings/{id}/checkout - persists the expected payment before any provider call, then makes sure the
// provider order exists. Idempotent by booking: one active payment order (database-enforced), so a repeated Pay or a
// retry with a different Idempotency-Key returns the same order. 200 with checkout config once READY; 202 while the
// provider order is pending or its creation is uncertain (the client polls GET /payment-orders/{id}). The hold
// deadline never moves.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    assertSameOrigin(request, identity.via);
    assertSupportedClient(request);
    const id = parseUuid((await context.params).id);
    const body = await parseBody(request, checkoutRequestSchema);
    const { order } = await startCheckout(getPaymentServices(), identity.claims, { bookingId: id, expectedVersion: body.expected_version }, requestId);
    const status = await loadPaymentOrderStatus(identity.claims, order.payment_order_id, body.client);
    return ok(requestId, status, status.checkout ? 200 : 202);
  });
}
