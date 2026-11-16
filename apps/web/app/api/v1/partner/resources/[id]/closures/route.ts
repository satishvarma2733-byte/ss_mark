import { z } from "zod";
import { closureRequestSchema } from "@simply-sit/contracts";
import { asUser, createClosure, DomainError, getDb } from "@simply-sit/db";
import { assertSameOrigin, handle, idempotent, ok, parseBody, requireIdempotencyKey } from "../../../../../../../lib/api";
import { requireUser } from "../../../../../../../lib/auth/identity";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/resources/{id}/closures - manager/owner with MFA (enforced inside app.create_closure).
// Overlap with any held/confirmed claim returns 409 with the conflicting references; nothing is cancelled silently.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    assertSameOrigin(request, identity.via);
    const key = requireIdempotencyKey(request);
    const { id } = await context.params;
    const resourceId = z.uuid().safeParse(id);
    if (!resourceId.success) throw new DomainError("NOT_FOUND");
    const body = await parseBody(request, closureRequestSchema);

    const result = await asUser(getDb(), identity.claims, async (tx) => {
      const [resource] = await tx`select venue_id from public.resources where id = ${resourceId.data}::uuid`;
      if (!resource) throw new DomainError("NOT_FOUND");
      return idempotent(tx, `POST /partner/resources/${resourceId.data}/closures`, key, body, async () => ({
        status: 201,
        data: await createClosure(
          tx,
          { venue_id: resource.venue_id as string, resource_ids: [resourceId.data], start_at: body.start_at, end_at: body.end_at, reason: body.reason },
          requestId
        )
      }));
    });
    return ok(requestId, result.data, result.status);
  });
}
