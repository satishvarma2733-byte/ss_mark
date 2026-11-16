import { partnerStaff } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET /api/v1/partner/venues/{id}/staff - members and open invitations (P08), managers/owners only.
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, {}, async ({ tx }) => partnerStaff(tx, await idParam(context)));
}
