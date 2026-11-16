import { describe, expect, it } from "vitest";
import { checkDuration, quoteTable } from "./quote";

describe("booking duration rules", () => {
  it("accepts 60 to 240 minutes in 30-minute steps", () => {
    for (const minutes of [60, 90, 120, 240]) {
      expect(checkDuration(minutes)).toEqual({ ok: true });
    }
  });

  it("rejects durations below the minimum or above the maximum", () => {
    expect(checkDuration(30)).toEqual({ ok: false, problem: "TOO_SHORT" });
    expect(checkDuration(270)).toEqual({ ok: false, problem: "TOO_LONG" });
  });

  it("rejects durations that are not on a 30-minute increment", () => {
    expect(checkDuration(75)).toEqual({ ok: false, problem: "NOT_IN_INCREMENTS" });
  });

  it("rejects fractional minutes", () => {
    expect(checkDuration(90.5)).toEqual({ ok: false, problem: "NOT_A_WHOLE_NUMBER" });
  });
});

describe("table quote", () => {
  it("prices whole 30-minute blocks in integer paise", () => {
    const quote = quoteTable({ pricePerBlockPaise: 15000, durationMinutes: 120 });
    expect(quote).toEqual({
      blocks: 4,
      seatingPaise: 60000,
      feesPaise: 0,
      totalPaise: 60000,
      pricingBasis: "per 30 minutes, one table",
      policyVersion: "proposed-2026-10-25"
    });
    expect(Number.isInteger(quote.totalPaise)).toBe(true);
  });

  it("refuses to quote an invalid duration rather than rounding it", () => {
    // 75 minutes is above the minimum but not on a 30-minute increment.
    expect(() => quoteTable({ pricePerBlockPaise: 15000, durationMinutes: 75 })).toThrow("NOT_IN_INCREMENTS");
  });

  it("refuses a fractional or negative price", () => {
    expect(() => quoteTable({ pricePerBlockPaise: 150.5, durationMinutes: 60 })).toThrow();
    expect(() => quoteTable({ pricePerBlockPaise: -1, durationMinutes: 60 })).toThrow();
  });
});
