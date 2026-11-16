import { myTicket } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET /api/v1/support-tickets/{id} - the reporter's own ticket with the customer-visible resolution only.
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, {}, async ({ tx }) => myTicket(tx, await idParam(context)));
}
