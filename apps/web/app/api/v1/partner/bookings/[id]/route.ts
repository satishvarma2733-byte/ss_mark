import { partnerBookingDetail } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET /api/v1/partner/bookings/{id} - P06 minimal booking view for the venue's staff; managers also see the total.
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, {}, async ({ tx }) => partnerBookingDetail(tx, await idParam(context)));
}
