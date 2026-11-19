import { zoneCreateSchema } from "@simply-sit/contracts";
import { partnerCreateZone } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/venues/{id}/zones - add a seating area (indoor, terrace, 1st floor ...).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; // label only; validated inside the transaction
  return authedRoute(request, { schema: zoneCreateSchema, idempotencyRoute: `POST /partner/venues/${id}/zones`, status: 201 },
    async ({ tx, body, requestId }) => partnerCreateZone(tx, await idParam(context), body, requestId));
}
