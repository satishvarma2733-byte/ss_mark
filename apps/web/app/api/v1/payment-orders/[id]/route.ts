import { paymentOrderQuerySchema } from "@simply-sit/contracts";
import { handle, ok, parseQuery, parseUuid } from "../../../../../lib/api";
import { requireUser } from "../../../../../lib/auth/identity";
import { loadPaymentOrderStatus } from "../../../../../lib/bookings";

export const dynamic = "force-dynamic";

// GET /api/v1/payment-orders/{id} - owner-only status for payment return and app resume. Read-only: it never confirms.
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    const id = parseUuid((await context.params).id);
    const { client } = parseQuery(request, paymentOrderQuerySchema);
    return ok(requestId, await loadPaymentOrderStatus(identity.claims, id, client));
  });
}
