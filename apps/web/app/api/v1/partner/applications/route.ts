import { partnerApplicationSchema } from "@simply-sit/contracts";
import { partnerApply } from "@simply-sit/db";
import { authedRoute } from "../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/applications - a signed-in user proposes a venue (P01): PENDING partner, DRAFT venue and their
// OWNER membership. Nothing is published or payable until platform review.
export function POST(request: Request, _context: { params: Promise<Record<string, never>> }) {
  return authedRoute(request, { schema: partnerApplicationSchema, idempotencyRoute: "POST /partner/applications", status: 201 },
    ({ tx, body, requestId }) => partnerApply(tx, body, requestId));
}
