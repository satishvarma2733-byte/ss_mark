import { cancelRequestSchema } from "@simply-sit/contracts";
import { asUser, cancelBooking, getDb } from "@simply-sit/db";
import { assertSameOrigin, handle, idempotent, ok, parseBody, parseUuid, requireIdempotencyKey } from "../../../../../../lib/api";
import { requireUser } from "../../../../../../lib/auth/identity";

export const dynamic = "force-dynamic";

// POST /api/v1/bookings/{id}/cancel - customer cancellation of a CONFIRMED booking before its start. The refund the
// customer was shown (expected_refund_paise) must still apply at the database clock, else 409 CANCELLATION_CHANGED with
// the new terms. Returns CANCELLED with the refund requested (not refunded); the provider refund is asynchronous.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    assertSameOrigin(request, identity.via);
    const key = requireIdempotencyKey(request);
    const id = parseUuid((await context.params).id);
    const body = await parseBody(request, cancelRequestSchema);
    const result = await asUser(getDb(), identity.claims, (tx) =>
      idempotent(tx, `POST /bookings/${id}/cancel`, key, body, async () => ({
        status: 200,
        data: await cancelBooking(
          tx,
          { booking_id: id, reason_code: body.reason_code ?? null, expected_version: body.expected_version, expected_refund_paise: body.expected_refund_paise },
          requestId
        )
      }))
    );
    return ok(requestId, result.data, result.status);
  });
}
