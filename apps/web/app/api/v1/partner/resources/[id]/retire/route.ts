import { resourceStatusSchema } from "@simply-sit/contracts";
import { partnerSetResourceStatus } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/resources/{id}/retire - owner only, never with future holds/bookings; history kept.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: resourceStatusSchema }, async ({ tx, body, requestId }) =>
    partnerSetResourceStatus(tx, await idParam(context), "RETIRE", body, requestId));
}
