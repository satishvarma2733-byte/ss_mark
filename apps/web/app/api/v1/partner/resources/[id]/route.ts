import { resourceUpdateSchema } from "@simply-sit/contracts";
import { partnerUpdateResource } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../lib/route";

export const dynamic = "force-dynamic";

// PATCH /api/v1/partner/resources/{id} - label/capacity; capacity cannot drop below a future booked party (409 + refs).
export function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: resourceUpdateSchema }, async ({ tx, body, requestId }) =>
    partnerUpdateResource(tx, await idParam(context), body, requestId));
}
