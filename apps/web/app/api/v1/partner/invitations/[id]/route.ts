import { partnerRevokeInvitation } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../lib/route";

export const dynamic = "force-dynamic";

// DELETE /api/v1/partner/invitations/{id} - withdraw an open invitation.
export function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, {}, async ({ tx, requestId }) => partnerRevokeInvitation(tx, await idParam(context), requestId));
}
