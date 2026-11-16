import { handle, ok } from "../../../../lib/api";
import { requireUser } from "../../../../lib/auth/identity";
import { loadMe } from "../../../../lib/me";

export const dynamic = "force-dynamic";

// GET /api/v1/me - own safe profile, roles and whether terms or MFA are still required.
export function GET() {
  return handle(async (requestId) => {
    const identity = await requireUser();
    return ok(requestId, await loadMe(identity.claims));
  });
}
