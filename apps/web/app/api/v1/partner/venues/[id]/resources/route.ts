import { resourceCreateSchema } from "@simply-sit/contracts";
import { partnerCreateResource } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/venues/{id}/resources - add an exclusive table with its first hourly rate (P04).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; // label only; validated inside the transaction
  return authedRoute(request, { schema: resourceCreateSchema, idempotencyRoute: `POST /partner/venues/${id}/resources`, status: 201 },
    async ({ tx, body, requestId }) => partnerCreateResource(tx, await idParam(context), body, requestId));
}
