import { verifyRequestSchema } from "@simply-sit/contracts";
import { DomainError } from "@simply-sit/db";
import { verifyForCustomer } from "@simply-sit/payments";
import { assertSameOrigin, handle, ok, parseBody, parseUuid } from "../../../../../../lib/api";
import { requireUser } from "../../../../../../lib/auth/identity";
import { toPaymentOrderStatus } from "../../../../../../lib/bookings";
import { paymentVerifyLimiter } from "../../../../../../lib/rate-limit";
import { getPaymentServices } from "../../../../../../lib/server-env";

export const dynamic = "force-dynamic";

// POST /api/v1/payment-orders/{id}/verify - after the provider returns the customer. The redirect values are hints:
// the server fetches the order's payments from the provider and applies their authoritative state. 200 only when the
// booking is CONFIRMED; otherwise 202 with the current pending/failed/refund-due state. Client success never confirms.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    assertSameOrigin(request, identity.via);
    const id = parseUuid((await context.params).id);
    if (!paymentVerifyLimiter.attempt(`${identity.authUserId}|${id}`)) throw new DomainError("RATE_LIMITED");
    const hint = await parseBody(request, verifyRequestSchema);
    const result = await verifyForCustomer(getPaymentServices(), identity.claims, id, hint);
    const status = toPaymentOrderStatus(result.order, "web");
    const body = { ...status, checkout: null, callback_signature: result.callbackSignature, provider_reachable: result.providerReachable };
    return ok(requestId, body, status.booking.status === "CONFIRMED" ? 200 : 202);
  });
}
