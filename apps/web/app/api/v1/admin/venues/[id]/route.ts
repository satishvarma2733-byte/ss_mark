import { adminVenueDetail } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/venues/{id} - application evidence and history for review (owner emails masked).
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, {}, async ({ tx }) => adminVenueDetail(tx, await idParam(context)));
}
