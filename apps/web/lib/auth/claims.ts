// Extracts the claims the database needs from an access token that the Auth server has ALREADY validated.
// This is decoding, not verification: never call it on a token that has not passed auth.getUser / verifyOtp.
import { DomainError, type VerifiedClaims } from "@simply-sit/db";

export function decodeClaims(accessToken: string): VerifiedClaims {
  const payload = accessToken.split(".")[1];
  if (!payload) throw new DomainError("AUTH_REQUIRED");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new DomainError("AUTH_REQUIRED");
  }
  if (typeof raw.sub !== "string" || raw.role !== "authenticated") throw new DomainError("AUTH_REQUIRED");
  const amr = Array.isArray(raw.amr)
    ? raw.amr
        .filter(
          (e): e is { method: string; timestamp: number } =>
            !!e && typeof e === "object" &&
            typeof (e as { method?: unknown }).method === "string" &&
            typeof (e as { timestamp?: unknown }).timestamp === "number"
        )
        .map(({ method, timestamp }) => ({ method, timestamp }))
    : [];
  return {
    sub: raw.sub,
    role: "authenticated",
    aal: raw.aal === "aal2" ? "aal2" : "aal1",
    amr,
    ...(typeof raw.session_id === "string" ? { session_id: raw.session_id } : {})
  };
}
