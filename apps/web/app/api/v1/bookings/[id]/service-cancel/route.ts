import { serviceCancelRequestSchema } from "@simply-sit/contracts";
import { asUser, getDb, serviceCancelBooking } from "@simply-sit/db";
import { assertSameOrigin, handle, idempotent, ok, parseBody, parseUuid, requireIdempotencyKey } from "../../../../../../lib/api";
import { requireUser } from "../../../../../../lib/auth/identity";

export const dynamic = "force-dynamic";

// POST /api/v1/bookings/{id}/service-cancel - venue- or platform-caused cancellation with a full refund (docs/07 s.4
// admin service-cancel; also the venue manager's way to resolve a booking before a conflicting closure). Assigned
// manager/owner or platform support/superadmin with TOTP; reason required; audited. Checked-in bookings are refused.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    assertSameOrigin(request, identity.via);
    const key = requireIdempotencyKey(request);
    const id = parseUuid((await context.params).id);
    const body = await parseBody(request, serviceCancelRequestSchema);
    const result = await asUser(getDb(), identity.claims, (tx) =>
      idempotent(tx, `POST /bookings/${id}/service-cancel`, key, body, async () => ({
        status: 200,
        data: await serviceCancelBooking(
          tx,
          { booking_id: id, reason_code: body.reason_code, reason: body.reason, expected_version: body.expected_version },
          requestId
        )
      }))
    );
    return ok(requestId, result.data, result.status);
  });
}
