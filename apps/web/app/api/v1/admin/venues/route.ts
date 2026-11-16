import { adminVenueQueue } from "@simply-sit/db";
import { authedRoute } from "../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/venues?status= - venue review queue (A02), support/superadmin with TOTP.
export function GET(request: Request, _context: { params: Promise<Record<string, never>> }) {
  return authedRoute(request, {}, ({ tx }) => adminVenueQueue(tx, new URL(request.url).searchParams.get("status") ?? "PENDING_REVIEW"));
}
