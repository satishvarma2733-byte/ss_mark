import { staffInviteSchema } from "@simply-sit/contracts";
import { partnerInvite } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/venues/{id}/staff-invitations - invite by email (managers: STAFF; owners: STAFF or MANAGER).
// The invitee accepts after signing in with that email; no secret is emailed.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; // label only; validated inside the transaction
  return authedRoute(request, { schema: staffInviteSchema, idempotencyRoute: `POST /partner/venues/${id}/staff-invitations`, status: 201 },
    async ({ tx, body, requestId }) => partnerInvite(tx, await idParam(context), body.email, body.role, requestId));
}
