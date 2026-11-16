import { ticketUpdateSchema } from "@simply-sit/contracts";
import { adminTicketDetail, adminUpdateTicket } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET/PATCH /api/v1/admin/support-tickets/{id} - detail with private notes; triage (status, priority, assignment,
// customer-visible resolution, note), audited. Confidential tickets: superadmins and the assigned admin only.
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, {}, async ({ tx }) => adminTicketDetail(tx, await idParam(context)));
}

export function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: ticketUpdateSchema }, async ({ tx, body, requestId }) =>
    adminUpdateTicket(tx, await idParam(context), body, requestId));
}
