import { expectedVersionSchema } from "@simply-sit/contracts";
import { approvePayoutBatch } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/admin/payout-batches/{id}/approve - a second finance person approves a draft. 409 RECONCILIATION_REQUIRED
// unless the latest run covering the batch period MATCHED; the payable is re-checked under the partner lock.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; // label only; validated inside the transaction
  return authedRoute(request, { schema: expectedVersionSchema, idempotencyRoute: `POST /admin/payout-batches/${id}/approve`, status: 202 },
    async ({ tx, body, requestId }) => approvePayoutBatch(tx, await idParam(context), body.expected_version, requestId));
}
