import { otpVerifySchema } from "@simply-sit/contracts";
import { acceptTerms, asUser, DomainError, getDb } from "@simply-sit/db";
import { assertSameOrigin, handle, ok, parseBody } from "../../../../../../lib/api";
import { decodeClaims } from "../../../../../../lib/auth/identity";
import { createSupabaseServerClient } from "../../../../../../lib/auth/supabase";
import { loadMe } from "../../../../../../lib/me";
import { clientKey, otpVerifyLimiter } from "../../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

// POST /api/v1/auth/otp/verify (web). Establishes an httpOnly cookie session; native apps verify through the SDK.
export function POST(request: Request) {
  return handle(async (requestId) => {
    assertSameOrigin(request, "none");
    const body = await parseBody(request, otpVerifySchema);
    if (!otpVerifyLimiter.attempt(clientKey(request, body.email))) throw new DomainError("RATE_LIMITED");

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({ email: body.email, token: body.code, type: "email" });
    if (error || !data.session) {
      if (error?.status === 429) throw new DomainError("RATE_LIMITED");
      throw new DomainError("VALIDATION_FAILED", { field: "code", reason: "invalid_or_expired" });
    }
    const claims = decodeClaims(data.session.access_token);
    let me = await loadMe(claims);
    if (me.terms_required && body.accept_terms === true) {
      await asUser(getDb(), claims, (tx) => acceptTerms(tx, me.current_terms_version, me.current_privacy_version));
      me = await loadMe(claims);
    }
    return ok(requestId, me);
  });
}
