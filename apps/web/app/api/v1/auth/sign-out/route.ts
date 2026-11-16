import { DomainError } from "@simply-sit/db";
import { assertSameOrigin, handle } from "../../../../../lib/api";
import { resolveIdentity } from "../../../../../lib/auth/identity";
import { createSupabaseServerClient, supabaseConfig } from "../../../../../lib/auth/supabase";

export const dynamic = "force-dynamic";

// POST /api/v1/auth/sign-out - revokes the current session at the Auth server and clears the web cookies.
export function POST(request: Request) {
  return handle(async (requestId) => {
    const identity = await resolveIdentity();
    if (identity.kind === "user" && identity.via === "bearer") {
      const { url, key } = supabaseConfig();
      const token = request.headers.get("authorization")!.replace(/^Bearer\s+/i, "");
      // Review fix R4: a failed revocation is reported (503) so the app knows the refresh token may still be valid;
      // the app clears its secure store either way. 401 means the session was already gone.
      const response = await fetch(`${url}/auth/v1/logout?scope=local`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${token}` } })
        .catch(() => null);
      if (!response || (!response.ok && response.status !== 401)) throw new DomainError("DEPENDENCY_UNAVAILABLE", { reason: "revocation_failed" });
    } else {
      assertSameOrigin(request, "cookie");
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut({ scope: "local" });
    }
    return new Response(null, { status: 204, headers: { "cache-control": "no-store", "x-request-id": requestId } });
  });
}
