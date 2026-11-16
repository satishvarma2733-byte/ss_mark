import { describe, expect, it } from "vitest";
import { csvCell, paiseToRupeeText, toCsv } from "./csv";

describe("csv export", () => {
  it("neutralises text that a spreadsheet would run as a formula", () => {
    for (const payload of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1"]) {
      expect(csvCell(payload).replace(/^"/, "").startsWith("'")).toBe(true);
    }
    expect(csvCell("Window table")).toBe("Window table");
  });

  it("keeps numbers as numbers, including negatives", () => {
    expect(csvCell(-1500)).toBe("-1500");
    expect(csvCell("-15.00")).toBe("-15.00");
    expect(csvCell("-15.00+1")).toBe("'-15.00+1");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(null)).toBe("");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell('Cafe, "Quiet"')).toBe('"Cafe, ""Quiet"""');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(csvCell("=a,b")).toBe("\"'=a,b\"");
  });

  it("joins rows with CRLF and ends with a newline", () => {
    expect(toCsv([["a", 1], ["b", null]])).toBe("a,1\r\nb,\r\n");
  });

  it("formats paise as rupees without floating point", () => {
    expect(paiseToRupeeText(123450)).toBe("1234.50");
    expect(paiseToRupeeText(5)).toBe("0.05");
    expect(paiseToRupeeText(-1500)).toBe("-15.00");
  });
});
