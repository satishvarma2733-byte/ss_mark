import { privacyRequestSchema } from "@simply-sit/contracts";
import { asUser, getDb, requestPrivacy } from "@simply-sit/db";
import { assertSameOrigin, handle, ok, parseBody } from "../../../../lib/api";
import { requireUser } from "../../../../lib/auth/identity";

export const dynamic = "force-dynamic";

// POST /api/v1/privacy-requests - requires an OTP/TOTP verification within 15 minutes (checked in the database from the
// verified token's amr claim). DELETE pauses new bookings and queues review; it is not immediate erasure.
export function POST(request: Request) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    assertSameOrigin(request, identity.via);
    const body = await parseBody(request, privacyRequestSchema);
    const result = await asUser(getDb(), identity.claims, (tx) => requestPrivacy(tx, body.kind));
    return ok(requestId, result, 202);
  });
}
