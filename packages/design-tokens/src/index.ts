// Brand & semantic design tokens aligned with Figma "04 — Color & Typography" (94:123 Light, 94:167 Dark).
// Preserves all legacy exports used by @simply-sit/mobile and @simply-sit/web while adding Light/Dark themes,
// typography scale, elevation/shadows, and motion tokens.

export interface ThemePalette {
  canvas: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  action: string;
  actionText: string;
  brandPrimary: string;
  brandSage: string;
  brandSand: string;
  success: string;
  successSurface: string;
  warning: string;
  warningSurface: string;
  error: string;
  errorSurface: string;
  focusRing: string;
}

export const lightTheme: ThemePalette = {
  canvas: "#F6F2E9",
  surface: "#FFFFFF",
  surfaceMuted: "#F3F6F0",
  border: "#E6E1D6",
  textPrimary: "#282A25",
  textSecondary: "#596153",
  action: "#526440",
  actionText: "#FFFFFF",
  brandPrimary: "#4F5A3F",
  brandSage: "#A3B18A",
  brandSand: "#DCCFBC",
  success: "#36804D",
  successSurface: "#EBF3E9",
  warning: "#9A4800",
  warningSurface: "#FDF3E7",
  error: "#A53D36",
  errorSurface: "#FBECEB",
  focusRing: "#245FC4"
} as const;

export const darkTheme: ThemePalette = {
  canvas: "#171C18",
  surface: "#222A23",
  surfaceMuted: "#303C30",
  border: "#485344",
  textPrimary: "#F6F2E9",
  textSecondary: "#C3CBBB",
  action: "#DCE3D2",
  actionText: "#171C18",
  brandPrimary: "#4F5A3F",
  brandSage: "#A3B18A",
  brandSand: "#DCCFBC",
  success: "#A9D7A6",
  successSurface: "#1E3324",
  warning: "#FFC48D",
  warningSurface: "#3A2816",
  error: "#FFB5AF",
  errorSurface: "#3E201E",
  focusRing: "#7CA9F8"
} as const;

export const themes = {
  light: lightTheme,
  dark: darkTheme
} as const;

export type ThemeMode = keyof typeof themes;

// Backward-compatible flat color map (Light mode defaults)
export const colors = {
  brandPrimary: "#4F5A3F",
  brandSage: "#A3B18A",
  brandSand: "#DCCFBC",
  surfaceCanvas: lightTheme.canvas,
  surfaceCard: lightTheme.surface,
  surfaceMuted: lightTheme.surfaceMuted,
  border: lightTheme.border,
  textPrimary: lightTheme.textPrimary,
  textMuted: lightTheme.textSecondary,
  action: lightTheme.action,
  statusSuccess: lightTheme.success,
  statusSuccessText: "#2E7D32",
  statusSuccessSurface: lightTheme.successSurface,
  noticeSurface: "#EAEDE3",
  mapSurface: "#E9E6DD",
  mapPark: "#CAD3BB",
  statusWarning: lightTheme.warning,
  statusError: lightTheme.error,
  focusRing: lightTheme.focusRing
} as const;

export const typography = {
  headingFamily: "Playfair Display, Georgia, serif",
  bodyFamily: "Montserrat, Arial, Helvetica, sans-serif",
  bodySize: "16px",
  bodyLineHeight: "1.5",
  helperMinSize: "14px",
  priceSize: "24px",
  priceLineHeight: "32px"
} as const;

// Figma 04 — Color & Typography scale (94:211–94:221)
export const typographyScale = {
  display48: { fontSize: "48px", lineHeight: "58px", fontWeight: 400, family: "heading" },
  editorial36: { fontSize: "36px", lineHeight: "44px", fontWeight: 400, family: "heading" },
  editorial28: { fontSize: "28px", lineHeight: "36px", fontWeight: 400, family: "heading" },
  heading24: { fontSize: "24px", lineHeight: "32px", fontWeight: 600, family: "body" },
  heading20: { fontSize: "20px", lineHeight: "28px", fontWeight: 600, family: "body" },
  heading18: { fontSize: "18px", lineHeight: "26px", fontWeight: 600, family: "body" },
  ui16Medium: { fontSize: "16px", lineHeight: "24px", fontWeight: 500, family: "body" },
  body16: { fontSize: "16px", lineHeight: "24px", fontWeight: 400, family: "body" },
  body14: { fontSize: "14px", lineHeight: "22px", fontWeight: 400, family: "body" },
  label14: { fontSize: "14px", lineHeight: "20px", fontWeight: 600, family: "body" },
  meta12: { fontSize: "12px", lineHeight: "18px", fontWeight: 500, family: "body" }
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, base: 16, lg: 24, xl: 32, xxl: 48 } as const;

export const radius = {
  sm: 6,
  button: 8,
  input: 8,
  card: 12,
  modal: 16,
  pill: 100
} as const;

export const shadows = {
  sm: "0 1px 2px rgba(40, 42, 37, 0.06)",
  md: "0 4px 12px rgba(40, 42, 37, 0.08)",
  lg: "0 12px 28px rgba(40, 42, 37, 0.12)"
} as const;

export const elevation = {
  base: 0,
  card: 1,
  sticky: 10,
  dropdown: 20,
  drawer: 30,
  modal: 40,
  toast: 50
} as const;

export const motion = {
  fastMs: 140,
  normalMs: 220,
  slowMs: 320,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)"
} as const;

export const breakpoints = { compactMax: 639, mediumMax: 1023, wideMin: 1440 } as const;

export const minTouchTargetPx = 44;
// Android's accessibility guideline (and Google's Accessibility Scanner) asks for 48 x 48 dp; iOS keeps 44 pt.
export const minTouchTargetAndroidDp = 48;

// Relative luminance and WCAG contrast ratio (https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio).
export function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(value)) throw new Error(`Invalid hex colour: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(value.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}
