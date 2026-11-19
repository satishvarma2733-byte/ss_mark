import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  apiErrorSchema, cancellationNotice, cancellationPolicySummary, cancelRequestSchema, checkInRequestSchema, checkoutRequestSchema,
  coarseCoordinate, decodeCursor, DOMAIN_ERRORS, encodeCursor, isDomainErrorCode, isOlderVersion, moneySchema, refundStatusText, venueSearchQuerySchema,
  venueDetailSchema, venueMonogram, venueSummarySchema
} from "./index";

describe("contracts", () => {
  it("rejects fractional or negative paise", () => {
    expect(moneySchema.safeParse({ amountPaise: 1.5, currency: "INR" }).success).toBe(false);
    expect(moneySchema.safeParse({ amountPaise: -1, currency: "INR" }).success).toBe(false);
    expect(moneySchema.safeParse({ amountPaise: 12000, currency: "INR" }).success).toBe(true);
  });

  it("rejects a non-INR currency in the pilot", () => {
    expect(moneySchema.safeParse({ amountPaise: 100, currency: "USD" }).success).toBe(false);
  });

  it("requires the synthetic flag on venue records", () => {
    const base = {
      id: "v1",
      name: "DEMO Venue",
      category: "cafe",
      locality: "Demo Locality",
      tableFromPrice: { amountPaise: 30000, currency: "INR" },
      pricingBasis: "per 30 minutes, one table",
      foodPolicy: { mode: "allowed", note: "Outside food allowed at this demo table." }
    };
    expect(venueSummarySchema.safeParse({ ...base, isSynthetic: true }).success).toBe(true);
    expect(venueSummarySchema.safeParse({ ...base, isSynthetic: false }).success).toBe(false);
  });

  it("parses the docs/07 error envelope (snake_case, request_id at top level)", () => {
    const parsed = apiErrorSchema.parse({
      error: { code: "NOT_FOUND", message: "We could not find that.", retryable: false, field_errors: {} },
      request_id: "req_1"
    });
    expect(parsed.error.code).toBe("NOT_FOUND");
    expect(parsed.request_id).toBe("req_1");
    expect(apiErrorSchema.safeParse({ error: { code: "X", message: "m", retryable: false, requestId: "r" } }).success).toBe(false);
  });

  it("maps every domain code to the HTTP status class in docs/07", () => {
    expect(DOMAIN_ERRORS.SLOT_UNAVAILABLE.status).toBe(409);
    expect(DOMAIN_ERRORS.QUOTE_EXPIRED.status).toBe(410);
    expect(DOMAIN_ERRORS.AUTH_REQUIRED.status).toBe(401);
    expect(DOMAIN_ERRORS.REAUTH_REQUIRED.status).toBe(403);
    expect(DOMAIN_ERRORS.PARTY_TOO_LARGE.status).toBe(422);
    expect(isDomainErrorCode("SLOT_UNAVAILABLE")).toBe(true);
    expect(isDomainErrorCode("toString")).toBe(false);
  });

  it("parses discovery queries strictly: comma lists, allowlisted tags, no unknown parameters", () => {
    const parsed = venueSearchQuerySchema.parse({ area: "koramangala", party_size: "3", environment_tags: "QUIET,OUTDOOR", available_only: "true" });
    expect(parsed).toMatchObject({ area: "koramangala", party_size: 3, environment_tags: ["QUIET", "OUTDOOR"], available_only: true });
    expect(venueSearchQuerySchema.safeParse({ environment_tags: "QUIET,NOISY" }).success).toBe(false);
    expect(venueSearchQuerySchema.safeParse({ area: "mumbai" }).success).toBe(false);
    expect(venueSearchQuerySchema.safeParse({ sort: "price" }).success).toBe(false);
  });

  it("rounds device coordinates to about 1 km and round-trips opaque cursors", () => {
    expect(coarseCoordinate(12.934567)).toBe(12.93);
    expect(coarseCoordinate(77.625901)).toBe(77.63);
    expect(decodeCursor(encodeCursor(40))).toBe(40);
    expect(decodeCursor(undefined)).toBe(0);
    expect(decodeCursor("40")).toBe("invalid");
    expect(decodeCursor("o-1")).toBe("invalid");
  });

  it("accepts either a QR token or reference + PIN for check-in, never both or neither", () => {
    const venue_id = "8f2b7c2e-1d4a-4c3b-9e7f-2a1b3c4d5e6f";
    expect(checkInRequestSchema.safeParse({ venue_id, qr_token: "A".repeat(43) }).success).toBe(true);
    expect(checkInRequestSchema.safeParse({ venue_id, public_ref: "ss-7kq2m9xhpa", pin: "123456" }).success).toBe(true);
    expect(checkInRequestSchema.safeParse({ venue_id, qr_token: "A".repeat(43), pin: "123456" }).success).toBe(false);
    expect(checkInRequestSchema.safeParse({ venue_id, public_ref: "SS-7KQ2M9XHPA" }).success).toBe(false);
    expect(checkInRequestSchema.safeParse({ venue_id, public_ref: "SS-OOOOOOOOOO", pin: "123456" }).success).toBe(false);
  });

  it("allowlists checkout return targets", () => {
    expect(checkoutRequestSchema.parse({ expected_version: 1 }).client).toBe("web");
    expect(checkoutRequestSchema.safeParse({ expected_version: 1, client: "https://evil.example" }).success).toBe(false);
  });

  it("knows every error code the database raises, so none degrades to a generic 500", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations");
    const raised = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
      for (const match of readFileSync(join(dir, file), "utf8").matchAll(/app\.fail\('([A-Z_]+)'/g)) raised.add(match[1]!);
    }
    raised.delete("IMMUTABLE_RECORD"); // invariant guard: deliberately mapped to INTERNAL_ERROR by the server
    expect(raised.size).toBeGreaterThan(10);
    expect([...raised].filter((code) => !isDomainErrorCode(code))).toEqual([]);
  });

  it("tells customers who cancelled: a customer's OTHER reason is never read as a venue cancellation", () => {
    expect(cancellationNotice("CUSTOMER:OTHER")).toBe("You cancelled this booking.");
    expect(cancellationNotice("CUSTOMER:UNSPECIFIED")).toBe("You cancelled this booking.");
    expect(cancellationNotice("SERVICE:TABLE_UNAVAILABLE")).toBe(
      "This booking was cancelled for you because the table is unavailable. You get a full refund.");
    expect(cancellationNotice("SERVICE:OTHER")).toBe("This booking was cancelled for you because an operational reason. You get a full refund.");
    expect(cancellationNotice("SERVICE:UNKNOWN_CODE")).toContain("cancelled for you");
  });

  it("states the accepted cancellation policy and never calls an unconfirmed refund refunded", () => {
    expect(cancellationPolicySummary({ cancel_cutoff_minutes: 120, early_refund_bps: 10000, late_refund_bps: 0 })).toBe(
      "Full refund if you cancel at least 2 hours before the start; no refund after that.");
    expect(cancellationPolicySummary({ cancel_cutoff_minutes: 90, early_refund_bps: 10000, late_refund_bps: 5000 })).toBe(
      "Full refund if you cancel at least 1 hour 30 minutes before the start; 50% refund after that.");
    for (const status of ["REQUESTED", "PROCESSING", "UNKNOWN"]) expect(refundStatusText(status)).not.toMatch(/refunded/);
    expect(refundStatusText("PROCESSED")).toBe("refunded by the payment provider");
    expect(refundStatusText("FAILED")).toMatch(/still owed/);
  });

  it("accepts only the customer's own reason codes and whole-paise expectations on cancel", () => {
    expect(cancelRequestSchema.safeParse({ expected_version: 2, expected_refund_paise: 36000 }).success).toBe(true);
    expect(cancelRequestSchema.safeParse({ expected_version: 2, expected_refund_paise: 36000, reason_code: "TABLE_UNAVAILABLE" }).success).toBe(false);
    expect(cancelRequestSchema.safeParse({ expected_version: 2, expected_refund_paise: 1.5 }).success).toBe(false);
    expect(cancelRequestSchema.safeParse({ expected_version: 2, expected_refund_paise: 0, refund_paise: 1 }).success).toBe(false);
  });

  it("compares native app versions numerically and treats an unreadable version as older", () => {
    expect(isOlderVersion("0.1.0", "0.2.0")).toBe(true);
    expect(isOlderVersion("0.10.0", "0.9.9")).toBe(false);
    expect(isOlderVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isOlderVersion("2.0.0", "1.9.9")).toBe(false);
    expect(isOlderVersion("garbage", "1.0.0")).toBe(true);
    expect(isOlderVersion("1.0.0", "not-a-version")).toBe(false);
  });

  it("builds the fallback venue monogram from up to two initials", () => {
    expect(venueMonogram("Chapter & Co.")).toBe("CC");
    expect(venueMonogram("the  quiet   room upstairs")).toBe("TQ");
    expect(venueMonogram("42 Brew")).toBe("B");
    expect(venueMonogram("")).toBe("S");
  });

  it("returns the venue logo as a nullable media reference", () => {
    const logo = venueDetailSchema.shape.logo;
    expect(logo.parse(undefined)).toBeNull();
    expect(logo.parse(null)).toBeNull();
    const ref = { id: "00000000-0000-4000-8000-000000000999", alt_text: "Round olive logo" };
    expect(logo.parse(ref)).toEqual(ref);
    expect(logo.safeParse({ id: "not-a-uuid", alt_text: "x" }).success).toBe(false);
  });
});


describe("seating contracts (seat-map phase 1)", async () => {
  const { layoutElementSchema, layoutDraftSchema, seatMapQuerySchema, tableDetailsSchema, zonePriceSchema } = await import("./index");
  const id = "33333333-3333-4333-8333-000000001041";

  it("requires a table reference on tables and only on tables", () => {
    expect(layoutElementSchema.safeParse({ type: "TABLE", resource_id: id, x: 0, y: 0, width: 80, height: 80 }).success).toBe(true);
    expect(layoutElementSchema.safeParse({ type: "TABLE", x: 0, y: 0, width: 80, height: 80 }).success).toBe(false);
    expect(layoutElementSchema.safeParse({ type: "DOOR", resource_id: id, x: 0, y: 0, width: 80, height: 30 }).success).toBe(false);
    expect(layoutElementSchema.safeParse({ type: "WALL", x: 0, y: 0, width: 80, height: 4, rotation: 45 }).success).toBe(false);
  });

  it("bounds the canvas and the number of elements", () => {
    const wall = { type: "WALL", x: 0, y: 0, width: 10, height: 10 };
    expect(layoutDraftSchema.safeParse({ width: 400, height: 300, elements: [wall], expected_version: null }).success).toBe(true);
    expect(layoutDraftSchema.safeParse({ width: 100, height: 300, elements: [], expected_version: null }).success).toBe(false);
    expect(layoutDraftSchema.safeParse({ width: 400, height: 300, elements: Array(301).fill(wall), expected_version: 1 }).success).toBe(false);
  });

  it("keeps custom table prices unless told otherwise and needs an offset on times", () => {
    expect(zonePriceSchema.parse({ hourly_paise: 15000, expected_version: 1 }).keep_custom_prices).toBe(true);
    expect(seatMapQuerySchema.safeParse({ start_at: "2026-11-20T11:00:00", duration_minutes: "60", party_size: "2" }).success).toBe(false);
    expect(seatMapQuerySchema.parse({ start_at: "2026-11-20T11:00:00+05:30", duration_minutes: "60", party_size: "2" }).party_size).toBe(2);
  });

  it("uses null to clear a table's area or photo", () => {
    expect(tableDetailsSchema.parse({ zone_id: null, photo_media_id: null, expected_version: 3 })).toEqual({ zone_id: null, photo_media_id: null, expected_version: 3 });
    expect(tableDetailsSchema.safeParse({ shape: "TRIANGLE", expected_version: 3 }).success).toBe(false);
  });
});
