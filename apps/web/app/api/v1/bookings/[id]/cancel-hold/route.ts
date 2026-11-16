import { cancelHoldRequestSchema } from "@simply-sit/contracts";
import { asUser, cancelHold, getDb } from "@simply-sit/db";
import { assertSameOrigin, handle, idempotent, ok, parseBody, parseUuid, requireIdempotencyKey } from "../../../../../../lib/api";
import { requireUser } from "../../../../../../lib/auth/identity";

export const dynamic = "force-dynamic";

// POST /api/v1/bookings/{id}/cancel-hold - customer abandons an unpaid hold; the table is released at once. A payment
// that still arrives becomes a full refund liability (never a confirmation).
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    assertSameOrigin(request, identity.via);
    const key = requireIdempotencyKey(request);
    const id = parseUuid((await context.params).id);
    const body = await parseBody(request, cancelHoldRequestSchema);
    const result = await asUser(getDb(), identity.claims, (tx) =>
      idempotent(tx, `POST /bookings/${id}/cancel-hold`, key, body, async () => ({
        status: 200,
        data: await cancelHold(tx, id, body.expected_version, requestId)
      }))
    );
    return ok(requestId, result.data, result.status);
  });
}
