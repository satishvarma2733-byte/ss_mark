import { describe, expect, it } from "vitest";
import { formatInrPaise } from "./format";

describe("formatInrPaise", () => {
  it("formats whole and fractional rupees from integer paise", () => {
    expect(formatInrPaise(15000)).toBe("₹150.00");
    expect(formatInrPaise(12345)).toBe("₹123.45");
    expect(formatInrPaise(0)).toBe("₹0.00");
  });

  it("uses Indian digit grouping for large amounts", () => {
    // Indian grouping: 1,234,567.89 rupees is written 12,34,567.89 (last three digits, then pairs).
    expect(formatInrPaise(123456789)).toBe("₹12,34,567.89");
  });

  it("refuses floats and negatives instead of guessing", () => {
    expect(() => formatInrPaise(10.5)).toThrow();
    expect(() => formatInrPaise(-100)).toThrow();
  });
});
