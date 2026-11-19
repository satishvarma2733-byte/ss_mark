import { zonePriceSchema } from "@simply-sit/contracts";
import { partnerSetZonePrice } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/zones/{id}/price - new hourly rate version for the area's tables from now or later (tables with
// their own price keep it unless keep_custom_prices is false). Existing quotes and bookings keep their prices.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: zonePriceSchema, status: 201 }, async ({ tx, body, requestId }) =>
    partnerSetZonePrice(tx, await idParam(context), body, requestId));
}
