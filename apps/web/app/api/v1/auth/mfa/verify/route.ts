import { z } from "zod";
import { DomainError } from "@simply-sit/db";
import { assertSameOrigin, handle, ok, parseBody } from "../../../../../../lib/api";
import { requireUser } from "../../../../../../lib/auth/identity";
import { createSupabaseServerClient } from "../../../../../../lib/auth/supabase";
import { clientKey, otpVerifyLimiter } from "../../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

const verifySchema = z.strictObject({ factor_id: z.uuid(), code: z.string().regex(/^\d{6}$/) });

// POST /api/v1/auth/mfa/verify - verifies a TOTP code; the refreshed aal2 session is written back to httpOnly cookies.
export function POST(request: Request) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    if (identity.via !== "cookie") throw new DomainError("FORBIDDEN", { reason: "web_session_required" });
    assertSameOrigin(request, "cookie");
    const body = await parseBody(request, verifySchema);
    if (!otpVerifyLimiter.attempt(clientKey(request, `mfa:${identity.authUserId}`))) throw new DomainError("RATE_LIMITED");

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: body.factor_id, code: body.code });
    if (error) {
      if (error.status === 429) throw new DomainError("RATE_LIMITED");
      throw new DomainError("VALIDATION_FAILED", { field: "code", reason: "invalid_or_expired" });
    }
    return ok(requestId, { aal: "aal2" });
  });
}
