import { hoursUpdateSchema } from "@simply-sit/contracts";
import { partnerSetHours } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// PUT /api/v1/partner/venues/{id}/hours - atomic replacement as a new schedule version; refused with references if a
// future hold/booking would fall outside the new hours.
export function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: hoursUpdateSchema }, async ({ tx, body, requestId }) =>
    partnerSetHours(tx, await idParam(context), body.periods, body.expected_version, requestId));
}
