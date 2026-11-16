import { checkInRequestSchema } from "@simply-sit/contracts";
import { asUser, getDb, staffCheckIn } from "@simply-sit/db";
import { assertSameOrigin, errorResponse, handle, idempotent, ok, parseBody, requireIdempotencyKey } from "../../../../../lib/api";
import { requireUser } from "../../../../../lib/auth/identity";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/check-in - staff scan the guest's QR token or enter reference + PIN. The database hashes and
// compares the code, applies the window/readiness/overlap rules and logs failed codes (the rate limit holds across
// instances). A wrong or other-venue code gets one generic 422 that reveals nothing about any booking. The failed
// attempt is committed together with its idempotency record, so a replay returns the same answer.
export function POST(request: Request) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    assertSameOrigin(request, identity.via);
    const key = requireIdempotencyKey(request);
    const body = await parseBody(request, checkInRequestSchema);
    const result = await asUser(getDb(), identity.claims, (tx) =>
      idempotent(tx, "POST /partner/check-in", key, body, async () => {
        const outcome = await staffCheckIn(
          tx,
          { venue_id: body.venue_id, qr_token: body.qr_token ?? null, public_ref: body.public_ref ?? null, pin: body.pin ?? null },
          requestId
        );
        return outcome.outcome === "INVALID" ? { status: 422, data: { outcome: "INVALID" } } : { status: 200, data: outcome };
      })
    );
    if (result.status === 422) return errorResponse(requestId, "ARRIVAL_CODE_INVALID");
    return ok(requestId, result.data, result.status);
  });
}
