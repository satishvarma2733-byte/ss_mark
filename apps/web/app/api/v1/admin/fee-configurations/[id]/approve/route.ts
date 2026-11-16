import { expectedVersionSchema } from "@simply-sit/contracts";
import { adminApproveFeeConfig } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/admin/fee-configurations/{id}/approve - a second finance person approves a draft fee version that is
// still in the future (403 SEPARATION_OF_DUTIES for its author).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; // label only; validated inside the transaction
  return authedRoute(request, { schema: expectedVersionSchema, idempotencyRoute: `POST /admin/fee-configurations/${id}/approve` },
    async ({ tx, body, requestId }) => adminApproveFeeConfig(tx, await idParam(context), body.expected_version, requestId));
}
