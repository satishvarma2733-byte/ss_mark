import { expectedVersionSchema } from "@simply-sit/contracts";
import { asUser, getDb, staffMarkReady } from "@simply-sit/db";
import { assertSameOrigin, handle, idempotent, ok, parseBody, parseUuid, requireIdempotencyKey } from "../../../../../../../lib/api";
import { requireUser } from "../../../../../../../lib/auth/identity";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/resources/{id}/ready - staff confirm turnover after cleaning. Rejected while a guest is checked
// in; an elapsed buffer never marks a table ready by itself.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    assertSameOrigin(request, identity.via);
    const key = requireIdempotencyKey(request);
    const id = parseUuid((await context.params).id);
    const body = await parseBody(request, expectedVersionSchema);
    const result = await asUser(getDb(), identity.claims, (tx) =>
      idempotent(tx, `POST /partner/resources/${id}/ready`, key, body, async () => ({
        status: 200,
        data: await staffMarkReady(tx, id, body.expected_version, requestId)
      }))
    );
    return ok(requestId, result.data, result.status);
  });
}
