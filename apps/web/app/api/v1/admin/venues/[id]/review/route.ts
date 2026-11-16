import { venueReviewSchema } from "@simply-sit/contracts";
import { adminReviewVenue } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/admin/venues/{id}/review - approve / request changes / reject / pause / resume with a reason (audited).
// Pausing lists the future bookings that need assessment; nothing is cancelled automatically.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; // label only; validated inside the transaction
  return authedRoute(request, { schema: venueReviewSchema, idempotencyRoute: `POST /admin/venues/${id}/review` },
    async ({ tx, body, requestId }) => adminReviewVenue(tx, await idParam(context), body, requestId));
}
