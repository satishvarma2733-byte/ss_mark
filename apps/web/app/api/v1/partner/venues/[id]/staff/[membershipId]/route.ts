import { expectedVersionSchema } from "@simply-sit/contracts";
import { partnerRevokeMember } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// DELETE /api/v1/partner/venues/{id}/staff/{membershipId} - revoke access. Managers remove STAFF; owners also managers.
// Nobody removes themselves or the last owner.
export function DELETE(request: Request, context: { params: Promise<{ id: string; membershipId: string }> }) {
  return authedRoute(request, { schema: expectedVersionSchema }, async ({ tx, body, requestId }) =>
    partnerRevokeMember(tx, await idParam(context, "membershipId"), body.expected_version, requestId));
}
