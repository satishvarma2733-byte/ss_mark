import { amenitiesTagsUpdateSchema } from "@simply-sit/contracts";
import { partnerSetAmenitiesTags } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// PUT /api/v1/partner/venues/{id}/amenities-and-tags - allowlisted catalogue; a changed accessibility description loses
// its verification.
export function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: amenitiesTagsUpdateSchema }, async ({ tx, body, requestId }) =>
    partnerSetAmenitiesTags(tx, await idParam(context), body, requestId));
}
