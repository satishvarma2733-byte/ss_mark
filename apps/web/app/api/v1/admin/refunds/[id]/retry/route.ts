import { refundRetrySchema } from "@simply-sit/contracts";
import { adminRetryRefund } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/admin/refunds/{id}/retry {reason} - finance retries a FAILED refund once, as a new provider operation for
// the same liability (no new journal, no new charge to the partner or platform). 202: requested, not refunded.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; // label only; validated inside the transaction
  return authedRoute(request, { schema: refundRetrySchema, idempotencyRoute: `POST /admin/refunds/${id}/retry`, status: 202 },
    async ({ tx, body, requestId }) => adminRetryRefund(tx, await idParam(context), body.reason, requestId));
}
