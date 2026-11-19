import { zoneUpdateSchema } from "@simply-sit/contracts";
import { partnerUpdateZone } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../lib/route";

export const dynamic = "force-dynamic";

// PATCH /api/v1/partner/zones/{id} - rename, kind, floor, features or order of a seating area.
export function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: zoneUpdateSchema }, async ({ tx, body, requestId }) =>
    partnerUpdateZone(tx, await idParam(context), body, requestId));
}
