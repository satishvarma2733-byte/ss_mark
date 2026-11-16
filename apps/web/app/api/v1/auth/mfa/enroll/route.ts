import { DomainError } from "@simply-sit/db";
import { assertSameOrigin, handle, ok } from "../../../../../../lib/api";
import { requireUser } from "../../../../../../lib/auth/identity";
import { createSupabaseServerClient } from "../../../../../../lib/auth/supabase";

export const dynamic = "force-dynamic";

// POST /api/v1/auth/mfa/enroll - starts TOTP enrolment. The secret is returned once, with no-store, for the user to add
// to an authenticator app; it is never logged or persisted by the application.
export function POST(request: Request) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    if (identity.via !== "cookie") throw new DomainError("FORBIDDEN", { reason: "web_session_required" });
    assertSameOrigin(request, "cookie");
    const supabase = await createSupabaseServerClient();
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const totp = (factors?.all ?? []).filter((f) => f.factor_type === "totp");
    if (totp.some((f) => f.status === "verified")) throw new DomainError("INVALID_TRANSITION", { reason: "already_enrolled" });
    // Abandoned, unverified attempts would otherwise accumulate.
    for (const factor of totp) await supabase.auth.mfa.unenroll({ factorId: factor.id });

    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Simply Sit authenticator" });
    if (error || !data) throw new DomainError("PROVIDER_UNAVAILABLE");
    return ok(requestId, { factor_id: data.id, qr_code: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri }, 201);
  });
}
