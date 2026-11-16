import { staffExtensionRequests } from "@simply-sit/db";
import { authedRoute } from "../../../../../lib/route";
import { parseUuid } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

// GET /api/v1/partner/extension-requests?venue_id= - open requests for the arrivals desk (no prices).
export function GET(request: Request) {
  return authedRoute(request, {}, ({ tx }) => staffExtensionRequests(tx, parseUuid(new URL(request.url).searchParams.get("venue_id") ?? "")));
}
