import { myInvitations } from "@simply-sit/db";
import { authedRoute } from "../../../../lib/route";

export const dynamic = "force-dynamic";

// GET /api/v1/invitations - open venue invitations for the caller's verified email.
export function GET(request: Request, _context: { params: Promise<Record<string, never>> }) {
  return authedRoute(request, {}, ({ tx }) => myInvitations(tx));
}
