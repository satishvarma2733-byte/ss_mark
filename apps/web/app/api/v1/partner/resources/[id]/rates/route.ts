import { rateCreateSchema } from "@simply-sit/contracts";
import { partnerSetRate } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/resources/{id}/rates - new immutable rate version from now or a future instant. Existing quotes
// and bookings keep their prices.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: rateCreateSchema, status: 201 }, async ({ tx, body, requestId }) =>
    partnerSetRate(tx, await idParam(context), body, requestId));
}
