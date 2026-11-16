import { acceptTermsSchema } from "@simply-sit/contracts";
import { acceptTerms, asUser, getDb } from "@simply-sit/db";
import { assertSameOrigin, handle, ok, parseBody } from "../../../../../lib/api";
import { requireUser } from "../../../../../lib/auth/identity";
import { loadMe } from "../../../../../lib/me";

export const dynamic = "force-dynamic";

// POST /api/v1/me/terms - records acceptance of the current (draft, synthetic) terms and privacy versions.
export function POST(request: Request) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    assertSameOrigin(request, identity.via);
    const body = await parseBody(request, acceptTermsSchema);
    await asUser(getDb(), identity.claims, (tx) => acceptTerms(tx, body.terms_version, body.privacy_version));
    return ok(requestId, await loadMe(identity.claims));
  });
}
