import { expectedVersionSchema } from "@simply-sit/contracts";
import { partnerSubmitPolicy } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/venues/{id}/policies/{policyId}/submit - send a live venue's policy change to platform review.
export function POST(request: Request, context: { params: Promise<{ id: string; policyId: string }> }) {
  return authedRoute(request, { schema: expectedVersionSchema, status: 202 }, async ({ tx, body, requestId }) =>
    partnerSubmitPolicy(tx, await idParam(context), await idParam(context, "policyId"), body.expected_version, requestId));
}
