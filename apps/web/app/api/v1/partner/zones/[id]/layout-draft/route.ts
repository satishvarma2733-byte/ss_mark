import { layoutDraftSchema } from "@simply-sit/contracts";
import { partnerSaveLayoutDraft } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// PUT /api/v1/partner/zones/{id}/layout-draft - replace the area's draft drawing. Refused whole (422 with every
// problem: overlap, outside canvas, table in another area ...) when invalid. Guests never see drafts.
export function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: layoutDraftSchema }, async ({ tx, body, requestId }) =>
    partnerSaveLayoutDraft(tx, await idParam(context), body, requestId));
}
