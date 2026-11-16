import { venueClosureSchema } from "@simply-sit/contracts";
import { createVenueClosure } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/venues/{id}/closures - blackout for listed tables or the whole venue (resource_ids null).
// Overlap with any held/confirmed claim returns 409 with the references; nothing is cancelled silently.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; // label only; validated inside the transaction
  return authedRoute(request, { schema: venueClosureSchema, idempotencyRoute: `POST /partner/venues/${id}/closures`, status: 201 },
    async ({ tx, body, requestId }) => createVenueClosure(tx, await idParam(context), body, requestId));
}
