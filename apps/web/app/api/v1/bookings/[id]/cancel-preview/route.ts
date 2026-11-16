import { asUser, cancelPreview, getDb } from "@simply-sit/db";
import { assertSameOrigin, handle, ok, parseUuid } from "../../../../../../lib/api";
import { requireUser } from "../../../../../../lib/auth/identity";

export const dynamic = "force-dynamic";

// POST /api/v1/bookings/{id}/cancel-preview - the refund owed under the booking's accepted policy if cancelled now.
// No mutation; the cancel call recomputes at the database clock and refuses a different amount.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    assertSameOrigin(request, identity.via);
    const id = parseUuid((await context.params).id);
    return ok(requestId, await asUser(getDb(), identity.claims, (tx) => cancelPreview(tx, id)));
  });
}
