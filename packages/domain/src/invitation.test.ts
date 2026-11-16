import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { arrivalCodes } from "./arrival";
import { INVITATION_TOKEN_PATTERN, invitationAcceptPath, invitationToken, invitationTokenHash } from "./invitation";

const SECRET = "s".repeat(43);
const INVITATION = "5d0c1f7a-2b3e-4c5d-8e9f-0a1b2c3d4e5f";

describe("invitation link tokens", () => {
  it("derives a stable opaque token per invitation, distinct from the arrival codes", () => {
    const token = invitationToken(SECRET, INVITATION);
    expect(invitationToken(SECRET, INVITATION)).toBe(token);
    expect(token).toMatch(INVITATION_TOKEN_PATTERN);
    expect(token).not.toContain(INVITATION);
    expect(invitationToken(SECRET, "6d0c1f7a-2b3e-4c5d-8e9f-0a1b2c3d4e5f")).not.toBe(token);
    expect(invitationToken("t".repeat(43), INVITATION)).not.toBe(token);
    expect(arrivalCodes(SECRET, INVITATION).qrToken).not.toBe(token);
  });

  it("hashes with the scheme app.accept_invitation uses: sha256(token)", () => {
    expect(invitationTokenHash(SECRET, INVITATION)).toBe(createHash("sha256").update(invitationToken(SECRET, INVITATION)).digest("hex"));
  });

  it("builds the partner-home accept link", () => {
    const url = new URL(invitationAcceptPath(SECRET, INVITATION), "http://localhost");
    expect(url.pathname).toBe("/partner");
    expect(url.searchParams.get("invitation")).toBe(INVITATION);
    expect(url.searchParams.get("token")).toBe(invitationToken(SECRET, INVITATION));
  });

  it("refuses a short secret", () => {
    expect(() => invitationToken("short", INVITATION)).toThrow("ARRIVAL_CODE_SECRET");
  });
});
