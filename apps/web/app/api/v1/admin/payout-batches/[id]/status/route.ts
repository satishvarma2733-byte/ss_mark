import { payoutMarkSchema } from "@simply-sit/contracts";
import { markPayoutBatch } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/admin/payout-batches/{id}/status - records what happened to the transfer: PROCESSING (optional transfer
// reference), PAID (evidence reference required), FAILED (reason; allocations released), CANCELLED (drafts only).
// Nothing is transferred by this application.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; // label only; validated inside the transaction
  return authedRoute(request, { schema: payoutMarkSchema, idempotencyRoute: `POST /admin/payout-batches/${id}/status` },
    async ({ tx, body, requestId }) => markPayoutBatch(tx, await idParam(context), body, requestId));
}
