import { extensionRequestSchema } from "@simply-sit/contracts";
import { requestExtension } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/bookings/{id}/extension-requests - more time on the customer's own checked-in booking (C11). REQUESTED
// with a provisional price and a five-minute staff deadline; nothing is reserved and the original end is unchanged.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; // label only; validated inside the transaction
  return authedRoute(request, { schema: extensionRequestSchema, idempotencyRoute: `POST /bookings/${id}/extension-requests`, status: 201,
    startsCommitment: true },
    async ({ tx, body, requestId }) => requestExtension(tx, await idParam(context), body.additional_minutes, body.expected_version, requestId));
}
