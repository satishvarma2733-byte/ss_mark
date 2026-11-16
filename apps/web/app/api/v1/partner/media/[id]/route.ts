import { partnerRemoveMedia } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../lib/route";

export const dynamic = "force-dynamic";

// DELETE /api/v1/partner/media/{id} - hide a photo (status REMOVED; the stored object is no longer publicly readable).
export function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, {}, async ({ tx, requestId }) => partnerRemoveMedia(tx, await idParam(context), requestId));
}
