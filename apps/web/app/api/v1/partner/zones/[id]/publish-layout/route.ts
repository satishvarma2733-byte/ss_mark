import { expectedVersionSchema } from "@simply-sit/contracts";
import { partnerPublishLayout } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/zones/{id}/publish-layout - publish the draft drawing (re-validated; every table needs a price).
// The previous published version is archived. Bookings are never moved.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: expectedVersionSchema }, async ({ tx, body, requestId }) =>
    partnerPublishLayout(tx, await idParam(context), body.expected_version, requestId));
}
