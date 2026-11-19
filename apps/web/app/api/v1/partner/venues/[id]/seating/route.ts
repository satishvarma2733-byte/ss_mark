import { partnerSeating } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET /api/v1/partner/venues/{id}/seating - floor editor state: areas with published and draft drawings, and every
// non-retired table with its area, shape, features, photo and current rate. Manager/owner (TOTP).
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, {}, async ({ tx }) => partnerSeating(tx, await idParam(context)));
}
