import { expectedVersionSchema } from "@simply-sit/contracts";
import { partnerSubmitVenue } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/venues/{id}/submit - DRAFT -> PENDING_REVIEW once profile, policy, a priced table, hours, a photo
// and a use-case tag exist (422 lists what is missing).
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: expectedVersionSchema, status: 202 }, async ({ tx, body, requestId }) =>
    partnerSubmitVenue(tx, await idParam(context), body.expected_version, requestId));
}
