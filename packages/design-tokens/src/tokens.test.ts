import { describe, expect, it } from "vitest";
import { colors, contrastRatio, darkTheme, lightTheme } from "./index";

describe("brand colour contrast (WCAG 2.2 AA)", () => {
  it("keeps body text readable on the cream canvas and white cards (Light mode)", () => {
    expect(contrastRatio(colors.textPrimary, colors.surfaceCanvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.textMuted, colors.surfaceCanvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.textMuted, colors.surfaceCard)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps primary action text and status labels at 4.5:1 (Light mode)", () => {
    expect(contrastRatio(colors.surfaceCard, colors.brandPrimary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(lightTheme.actionText, lightTheme.action)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.statusSuccess, colors.surfaceCard)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.statusWarning, colors.surfaceCard)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.statusError, colors.surfaceCard)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps body text, actions, and status labels at 4.5:1 in Dark mode", () => {
    expect(contrastRatio(darkTheme.textPrimary, darkTheme.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkTheme.textSecondary, darkTheme.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkTheme.textSecondary, darkTheme.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkTheme.actionText, darkTheme.action)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkTheme.success, darkTheme.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkTheme.warning, darkTheme.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkTheme.error, darkTheme.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the small header tagline (sand on brand primary) at 4.5:1", () => {
    expect(contrastRatio(colors.brandSand, colors.brandPrimary)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the focus ring at least 3:1 against the canvas in both themes", () => {
    expect(contrastRatio(lightTheme.focusRing, lightTheme.canvas)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(darkTheme.focusRing, darkTheme.canvas)).toBeGreaterThanOrEqual(3);
  });

  it("confirms sage is decorative: dark text on sage passes, sage text on cream does not", () => {
    expect(contrastRatio(colors.textPrimary, colors.brandSage)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.brandSage, colors.surfaceCanvas)).toBeLessThan(4.5);
  });
});
