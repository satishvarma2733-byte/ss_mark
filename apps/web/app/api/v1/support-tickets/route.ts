import { ticketCreateSchema } from "@simply-sit/contracts";
import { createTicket, myTickets } from "@simply-sit/db";
import { authedRoute } from "../../../../lib/route";

export const dynamic = "force-dynamic";

// GET/POST /api/v1/support-tickets - the caller's own tickets; a linked booking must be their own. Private support
// notes are never returned. Safety tickets are confidential.
export function GET(request: Request) {
  return authedRoute(request, {}, ({ tx }) => myTickets(tx));
}

export function POST(request: Request) {
  return authedRoute(request, { schema: ticketCreateSchema, idempotencyRoute: "POST /support-tickets", status: 201 },
    ({ tx, body, requestId }) => createTicket(tx, body, requestId));
}
