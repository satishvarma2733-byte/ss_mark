import { tableDetailsSchema } from "@simply-sit/contracts";
import { partnerSetTableDetails } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// PATCH /api/v1/partner/resources/{id}/details - area, shape, features and photo (an approved venue photo). null
// clears the area or photo. Changing area is refused while a floor drawing shows the table.
export function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: tableDetailsSchema }, async ({ tx, body, requestId }) =>
    partnerSetTableDetails(tx, await idParam(context), body, requestId));
}
