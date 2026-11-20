import { partnerArchiveRateRule } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/rate-rules/{id}/archive - stop a busy-hour rule for new quotes. Rules are never edited.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, {}, async ({ tx, requestId }) => partnerArchiveRateRule(tx, await idParam(context), requestId));
}
