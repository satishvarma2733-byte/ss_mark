import { policyReviewSchema } from "@simply-sit/contracts";
import { adminReviewPolicy } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/admin/policies/{id}/review - approve or return a live venue's submitted policy change.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: policyReviewSchema }, async ({ tx, body, requestId }) =>
    adminReviewPolicy(tx, await idParam(context), body, requestId));
}
