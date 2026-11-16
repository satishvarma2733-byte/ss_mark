// Arrival codes for staff check-in (docs/02 s.5). SERVER-ONLY: needs the arrival secret.
// The QR token and PIN are derived from the booking ID with HMAC-SHA256, so nothing secret is stored. The database
// keeps only SHA-256 hashes (bookings.checkin_token_hash / checkin_pin_hash), written in the confirmation transaction,
// and app.staff_check_in hashes what staff enter with the same scheme (app.sha256_hex). Rotating the secret
// invalidates codes of existing confirmed bookings, so rotation needs a re-issue step (recorded for M5).
import { createHash, createHmac } from "node:crypto";

export type ArrivalCodes = { qrToken: string; pin: string };
export type ArrivalHashes = { tokenHash: string; pinHash: string };

function requireSecret(secret: string): string {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("ARRIVAL_CODE_SECRET must be at least 32 characters");
  return secret;
}

export function arrivalCodes(secret: string, bookingId: string): ArrivalCodes {
  const key = requireSecret(secret);
  const qrToken = createHmac("sha256", key).update(`arrival-token:v1:${bookingId}`).digest("base64url");
  const pinNumber = createHmac("sha256", key).update(`arrival-pin:v1:${bookingId}`).digest().readUInt32BE(0) % 1_000_000;
  return { qrToken, pin: pinNumber.toString().padStart(6, "0") };
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// Must match app.staff_check_in: sha256(token) and sha256(booking_id || ':' || pin).
export function arrivalHashes(secret: string, bookingId: string): ArrivalHashes {
  const { qrToken, pin } = arrivalCodes(secret, bookingId);
  return { tokenHash: sha256Hex(qrToken), pinHash: sha256Hex(`${bookingId}:${pin}`) };
}
