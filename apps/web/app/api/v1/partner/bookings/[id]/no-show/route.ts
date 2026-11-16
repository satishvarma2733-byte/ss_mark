import { expectedVersionSchema } from "@simply-sit/contracts";
import { staffMarkNoShow } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/bookings/{id}/no-show - assigned staff after the grace period; the paid interval stays allocated.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; // label only; validated inside the transaction
  return authedRoute(request, { schema: expectedVersionSchema, idempotencyRoute: `POST /partner/bookings/${id}/no-show` },
    async ({ tx, body, requestId }) => staffMarkNoShow(tx, await idParam(context), body.expected_version, requestId));
}
