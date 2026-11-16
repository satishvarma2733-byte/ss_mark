import { DomainError } from "@simply-sit/db";
import { handle, ok } from "../../../../../lib/api";
import { requireUser } from "../../../../../lib/auth/identity";
import { createSupabaseServerClient } from "../../../../../lib/auth/supabase";

export const dynamic = "force-dynamic";

// GET /api/v1/auth/mfa - current assurance level and the caller's TOTP factors (web session only).
export function GET() {
  return handle(async (requestId) => {
    const identity = await requireUser();
    if (identity.via !== "cookie") throw new DomainError("FORBIDDEN", { reason: "web_session_required" });
    const supabase = await createSupabaseServerClient();
    const [{ data: aal }, { data: factors, error }] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors()
    ]);
    if (error) throw new DomainError("PROVIDER_UNAVAILABLE");
    return ok(requestId, {
      aal: aal?.currentLevel ?? "aal1",
      next_level: aal?.nextLevel ?? "aal1",
      factors: (factors?.all ?? [])
        .filter((f) => f.factor_type === "totp")
        .map((f) => ({ id: f.id, status: f.status, friendly_name: f.friendly_name ?? null }))
    });
  });
}
