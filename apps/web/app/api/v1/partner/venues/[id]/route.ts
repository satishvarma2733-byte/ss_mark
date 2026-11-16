import { venueProfileUpdateSchema } from "@simply-sit/contracts";
import { partnerUpdateVenue, partnerVenueOverview } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET/PATCH /api/v1/partner/venues/{id} - manager/owner (TOTP) view and profile edits (P03). Staff 403, others 404.
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, {}, async ({ tx }) => partnerVenueOverview(tx, await idParam(context)));
}

export function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: venueProfileUpdateSchema }, async ({ tx, body, requestId }) => {
    const { expected_version, ...fields } = body;
    return partnerUpdateVenue(tx, await idParam(context), fields, expected_version, requestId);
  });
}
