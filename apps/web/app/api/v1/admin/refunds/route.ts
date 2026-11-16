import { adminRefundSchema } from "@simply-sit/contracts";
import { adminRefund } from "@simply-sit/db";
import { authedRoute } from "../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/admin/refunds - finance refund with a reason (audited). 202: the refund is requested, not refunded;
// the provider confirms it asynchronously. Never above what the payment has left; a finished booking's refund is
// charged to the partner or the platform.
export function POST(request: Request) {
  return authedRoute(request, { schema: adminRefundSchema, idempotencyRoute: "POST /admin/refunds", status: 202 },
    ({ tx, body, requestId }) => adminRefund(tx, body, requestId));
}
