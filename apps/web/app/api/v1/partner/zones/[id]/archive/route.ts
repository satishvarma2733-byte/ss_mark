import { expectedVersionSchema } from "@simply-sit/contracts";
import { partnerArchiveZone } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/zones/{id}/archive - only an area without tables; its drawings stop showing.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: expectedVersionSchema }, async ({ tx, body, requestId }) =>
    partnerArchiveZone(tx, await idParam(context), body.expected_version, requestId));
}
