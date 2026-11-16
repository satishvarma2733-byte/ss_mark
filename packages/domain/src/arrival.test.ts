import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { arrivalCodes, arrivalHashes } from "./arrival";

const SECRET = "s".repeat(43);
const BOOKING = "8f2b7c2e-1d4a-4c3b-9e7f-2a1b3c4d5e6f";

describe("arrival codes", () => {
  it("derives a stable opaque QR token and a 6-digit PIN per booking", () => {
    const a = arrivalCodes(SECRET, BOOKING);
    expect(arrivalCodes(SECRET, BOOKING)).toEqual(a);
    expect(a.qrToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.pin).toMatch(/^\d{6}$/);
    expect(a.qrToken).not.toContain(BOOKING);
    const other = arrivalCodes(SECRET, "0b2b7c2e-1d4a-4c3b-9e7f-2a1b3c4d5e6f");
    expect(other.qrToken).not.toBe(a.qrToken);
    expect(arrivalCodes("t".repeat(43), BOOKING).qrToken).not.toBe(a.qrToken);
  });

  it("hashes with the scheme app.staff_check_in uses: sha256(token) and sha256(booking_id:pin)", () => {
    const { qrToken, pin } = arrivalCodes(SECRET, BOOKING);
    const hashes = arrivalHashes(SECRET, BOOKING);
    expect(hashes.tokenHash).toBe(createHash("sha256").update(qrToken).digest("hex"));
    expect(hashes.pinHash).toBe(createHash("sha256").update(`${BOOKING}:${pin}`).digest("hex"));
  });

  it("refuses a short secret", () => {
    expect(() => arrivalCodes("short", BOOKING)).toThrow("ARRIVAL_CODE_SECRET");
  });
});
