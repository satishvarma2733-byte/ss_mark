// Builds the GET /me projection from RLS-scoped reads of the caller's own rows.
import type { Me } from "@simply-sit/contracts";
import { asUser, DomainError, getDb, getMe, type VerifiedClaims } from "@simply-sit/db";

export async function loadMe(claims: VerifiedClaims): Promise<Me> {
  const row = await asUser(getDb(), claims, (tx) => getMe(tx));
  if (!row) throw new DomainError("AUTH_REQUIRED");
  const hasPortalRole = row.venue_memberships.length > 0 || row.platform_roles.length > 0;
  return {
    profile_id: row.profile_id,
    display_name: row.display_name,
    status: row.status,
    terms_required: row.terms_version !== row.current_terms_version,
    current_terms_version: row.current_terms_version,
    current_privacy_version: row.current_privacy_version,
    aal: claims.aal,
    mfa_required_for_portal: hasPortalRole && claims.aal !== "aal2",
    venue_memberships: row.venue_memberships,
    platform_roles: row.platform_roles,
    version: row.version
  };
}
