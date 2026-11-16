import { extensionHoldSchema } from "@simply-sit/contracts";
import { holdExtension } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/extension-requests/{id}/hold - after approval and before the original end: fresh price (409 QUOTE_CHANGED
// with the new amount), then the booking's own claim is widened atomically; 409 if the next booking or a blackout won.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; // label only; validated inside the transaction
  return authedRoute(request, { schema: extensionHoldSchema, idempotencyRoute: `POST /extension-requests/${id}/hold`, status: 201,
    startsCommitment: true },
    async ({ tx, body, requestId }) => holdExtension(tx, await idParam(context), body.accepted_price_paise, body.expected_version, requestId));
}
