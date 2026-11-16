import { reviewCreateSchema } from "@simply-sit/contracts";
import { createReview } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/bookings/{id}/reviews - once, by the customer, for a COMPLETED booking. Pending until moderated.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; // label only; validated inside the transaction
  return authedRoute(request, { schema: reviewCreateSchema, idempotencyRoute: `POST /bookings/${id}/reviews`, status: 201 },
    async ({ tx, body, requestId }) => createReview(tx, await idParam(context), body.rating, body.body ?? null, requestId));
}
