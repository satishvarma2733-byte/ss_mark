// Resolves who is calling. Exactly one identity source is accepted per request: the web session cookie OR a native
// bearer token (docs/07 s.1 "Reject ambiguous competing identities"). Claims are only taken from a token that the
// Auth server has just validated, so a revoked session fails before any protected write.
import { DomainError, type VerifiedClaims } from "@simply-sit/db";
import { cookies, headers } from "next/headers";
import { decodeClaims } from "./claims";
import { hasSupabaseSessionCookie } from "./cookies";
import { createSupabaseServerClient, createSupabaseTokenClient } from "./supabase";

export { decodeClaims } from "./claims";

export type Identity =
  | { kind: "anonymous" }
  // accessToken: the caller's own verified token, used only to call Supabase Storage as that user. Never logged/returned.
  | { kind: "user"; via: "cookie" | "bearer"; authUserId: string; email: string | null; claims: VerifiedClaims; accessToken: string };

function bearerFrom(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(authorization.trim());
  if (!match) throw new DomainError("MALFORMED_REQUEST", { field: "Authorization" });
  return match[1]!;
}

export async function resolveIdentity(): Promise<Identity> {
  const headerStore = await headers();
  const cookieStore = await cookies();
  const bearer = bearerFrom(headerStore.get("authorization"));
  const hasCookie = hasSupabaseSessionCookie(cookieStore.getAll().map((c) => c.name));

  if (bearer && hasCookie) throw new DomainError("MALFORMED_REQUEST", { reason: "ambiguous_identity" });

  if (bearer) {
    const { data, error } = await createSupabaseTokenClient().auth.getUser(bearer);
    if (error || !data.user) throw new DomainError("SESSION_EXPIRED");
    return { kind: "user", via: "bearer", authUserId: data.user.id, email: data.user.email ?? null, claims: decodeClaims(bearer), accessToken: bearer };
  }

  if (!hasCookie) return { kind: "anonymous" };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { kind: "anonymous" };
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { kind: "anonymous" };
  return { kind: "user", via: "cookie", authUserId: data.user.id, email: data.user.email ?? null, claims: decodeClaims(token), accessToken: token };
}

export async function requireUser(): Promise<Extract<Identity, { kind: "user" }>> {
  const identity = await resolveIdentity();
  if (identity.kind !== "user") throw new DomainError("AUTH_REQUIRED");
  return identity;
}
