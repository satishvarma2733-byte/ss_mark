// Venue invitation link tokens (M5.1 review F1). SERVER-ONLY: needs the server secret (ARRIVAL_CODE_SECRET, under its
// own HMAC label). A confirmed Auth email alone does not prove the invitee reads that mailbox, so accepting needs the
// token from the invitation email as well. The token is derived from the invitation ID, so nothing secret is stored
// and a resent email carries the same link; the database keeps only its SHA-256 hash (venue_invitations.token_hash)
// and app.accept_invitation hashes what the invitee presents with the same scheme (app.sha256_hex). Rotating the
// secret invalidates the links of open invitations, which managers then send again.
import { createHmac } from "node:crypto";
import { sha256Hex } from "./arrival";

export const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function invitationToken(secret: string, invitationId: string): string {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("ARRIVAL_CODE_SECRET must be at least 32 characters");
  return createHmac("sha256", secret).update(`invitation-token:v1:${invitationId}`).digest("base64url");
}

export function invitationTokenHash(secret: string, invitationId: string): string {
  return sha256Hex(invitationToken(secret, invitationId));
}

// Relative link in the invitation email; the partner home accepts it after sign-in with the invited address.
export function invitationAcceptPath(secret: string, invitationId: string): string {
  const query = new URLSearchParams({ invitation: invitationId, token: invitationToken(secret, invitationId) });
  return `/partner?${query.toString()}`;
}
