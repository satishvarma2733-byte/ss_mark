import { policyDraftSchema } from "@simply-sit/contracts";
import { partnerSavePolicyDraft } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/venues/{id}/policies - save the venue's single editable policy draft. Published policies and
// accepted booking snapshots never change.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: policyDraftSchema }, async ({ tx, body, requestId }) =>
    partnerSavePolicyDraft(tx, await idParam(context), body, requestId));
}
