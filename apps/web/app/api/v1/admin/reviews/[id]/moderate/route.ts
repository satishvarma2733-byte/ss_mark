import { reviewModerationSchema } from "@simply-sit/contracts";
import { moderateReview } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/admin/reviews/{id}/moderate - publish, or hide with a reason (audited).
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: reviewModerationSchema }, async ({ tx, body, requestId }) =>
    moderateReview(tx, await idParam(context), body, requestId));
}
