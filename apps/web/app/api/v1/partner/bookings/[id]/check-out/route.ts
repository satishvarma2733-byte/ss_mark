import { expectedVersionSchema } from "@simply-sit/contracts";
import { asUser, getDb, staffCheckOut } from "@simply-sit/db";
import { assertSameOrigin, handle, idempotent, ok, parseBody, parseUuid, requireIdempotencyKey } from "../../../../../../../lib/api";
import { requireUser } from "../../../../../../../lib/auth/identity";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/bookings/{id}/check-out - COMPLETED, arrival codes revoked, table CLEANING. The sold interval
// stays claimed; only staff readiness makes the table READY again.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    assertSameOrigin(request, identity.via);
    const key = requireIdempotencyKey(request);
    const id = parseUuid((await context.params).id);
    const body = await parseBody(request, expectedVersionSchema);
    const result = await asUser(getDb(), identity.claims, (tx) =>
      idempotent(tx, `POST /partner/bookings/${id}/check-out`, key, body, async () => ({
        status: 200,
        data: await staffCheckOut(tx, id, body.expected_version, requestId)
      }))
    );
    return ok(requestId, result.data, result.status);
  });
}
