import { mediaReviewSchema } from "@simply-sit/contracts";
import { adminReviewMedia } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/admin/media/{id}/review - approve or reject one pending photo.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: mediaReviewSchema }, async ({ tx, body, requestId }) =>
    adminReviewMedia(tx, await idParam(context), body.decision, body.reason ?? null, requestId));
}
