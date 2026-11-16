import { holdRequestSchema } from "@simply-sit/contracts";
import { asUser, createBookingHold, getDb } from "@simply-sit/db";
import { assertSameOrigin, handle, idempotent, ok, parseBody, requireIdempotencyKey } from "../../../../lib/api";
import { requireUser } from "../../../../lib/auth/identity";
import { assertSupportedClient } from "../../../../lib/service-status";

export const dynamic = "force-dynamic";

// POST /api/v1/booking-holds - atomic hold. Idempotency record, booking, claim and event commit in one transaction.
export function POST(request: Request) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    assertSameOrigin(request, identity.via);
    assertSupportedClient(request);
    const key = requireIdempotencyKey(request);
    const body = await parseBody(request, holdRequestSchema);
    const result = await asUser(getDb(), identity.claims, (tx) =>
      idempotent(tx, "POST /booking-holds", key, body, async () => ({
        status: 201,
        data: await createBookingHold(tx, body, requestId)
      }))
    );
    const response = ok(requestId, result.data, result.status);
    if (result.replayed) response.headers.set("idempotent-replayed", "true");
    return response;
  });
}
