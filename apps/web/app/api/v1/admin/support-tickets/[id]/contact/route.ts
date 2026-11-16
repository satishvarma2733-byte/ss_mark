import { contactRevealSchema } from "@simply-sit/contracts";
import { adminTicketContact } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/admin/support-tickets/{id}/contact - contact escalation: the reporter's email for this ticket, with a
// reason. Every reveal is audited. Not cached.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: contactRevealSchema }, async ({ tx, body, requestId }) =>
    adminTicketContact(tx, await idParam(context), body.reason, requestId));
}
