// Portal (partner/staff/admin) access: signed in, an assigned role, and a TOTP-verified (aal2) session.
// Pages use this to choose what to render; every API call is re-checked by the database functions and RLS.
import { DomainError, isVenueMember, asUser, getDb } from "@simply-sit/db";
import type { Identity } from "./auth/identity";

export function requireAal2(identity: Extract<Identity, { kind: "user" }>) {
  if (identity.claims.aal !== "aal2") throw new DomainError("REAUTH_REQUIRED", { reason: "mfa_required" });
}

// Unassigned callers get NOT_FOUND so the response does not reveal whether the venue exists (docs/07 s.1).
export async function requireVenueMember(
  identity: Extract<Identity, { kind: "user" }>,
  venueId: string,
  roles?: ("STAFF" | "MANAGER" | "OWNER")[]
) {
  const member = await asUser(getDb(), identity.claims, (tx) => isVenueMember(tx, venueId, roles));
  if (!member) throw new DomainError("NOT_FOUND");
  requireAal2(identity);
}
