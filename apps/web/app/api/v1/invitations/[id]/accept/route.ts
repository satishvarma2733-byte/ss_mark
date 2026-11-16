import { invitationAcceptSchema } from "@simply-sit/contracts";
import { acceptInvitation } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/invitations/{id}/accept {token} - the signed-in owner of the invited email, holding the token from the
// invitation email's link (M5.1 review F1); never downgrades a role. Any mismatch is 404.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: invitationAcceptSchema },
    async ({ tx, body, requestId }) => acceptInvitation(tx, await idParam(context), body.token, requestId));
}
