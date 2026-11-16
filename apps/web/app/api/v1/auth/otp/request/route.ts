import { randomUUID } from "node:crypto";
import { otpRequestSchema } from "@simply-sit/contracts";
import { DomainError } from "@simply-sit/db";
import { assertSameOrigin, handle, ok, parseBody, safeRedirectPath } from "../../../../../../lib/api";
import { createSupabaseServerClient } from "../../../../../../lib/auth/supabase";
import { clientKey, otpRequestLimiter } from "../../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

// POST /api/v1/auth/otp/request - always a generic 202 so the response never reveals whether an account exists.
export function POST(request: Request) {
  return handle(async (requestId) => {
    assertSameOrigin(request, "none");
    const body = await parseBody(request, otpRequestSchema);
    if (!otpRequestLimiter.attempt(clientKey(request, body.email))) throw new DomainError("RATE_LIMITED");

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({ email: body.email, options: { shouldCreateUser: true } });
    if (error) {
      // Supabase's own resend cooldown and send limits surface as 429; other failures are provider outages.
      if (error.status === 429) throw new DomainError("RATE_LIMITED");
      throw new DomainError("PROVIDER_UNAVAILABLE");
    }
    return ok(
      requestId,
      { challenge_id: randomUUID(), resend_after_seconds: 60, redirect_path: safeRedirectPath(body.redirect_path) },
      202
    );
  });
}
