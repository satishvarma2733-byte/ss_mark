import { resourceStatusSchema } from "@simply-sit/contracts";
import { partnerSetResourceStatus } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/resources/{id}/pause - stop new holds on this table now; existing holds/bookings stay and are
// returned for explicit resolution (service cancel, then retry the closure).
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: resourceStatusSchema }, async ({ tx, body, requestId }) =>
    partnerSetResourceStatus(tx, await idParam(context), "PAUSE", body, requestId));
}
