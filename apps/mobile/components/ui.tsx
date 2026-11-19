// Shared building blocks for the customer screens, styled to the Figma "Customer mobile" frames: Montserrat interface
// text, Playfair Display headlines, 48 dp actions, sand-bordered cards and tinted notices. Touch targets follow the
// platform minimum (48 dp Android, 44 pt iOS); roles and states are set for screen readers.
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, lightTheme, minTouchTargetAndroidDp, minTouchTargetPx, radius, spacing } from "@simply-sit/design-tokens";

export const minTouchTarget = Platform.OS === "android" ? minTouchTargetAndroidDp : minTouchTargetPx;

// Font family names registered in app/_layout.tsx (bundled OFL fonts from the brand kit).
export const fonts = {
  regular: "Montserrat-Regular",
  medium: "Montserrat-Medium",
  semibold: "Montserrat-SemiBold",
  display: "PlayfairDisplay-Regular"
} as const;

// Figma tints aligned with lightTheme tokens.
export const tints = {
  warmSurface: lightTheme.warningSurface,
  warmText: lightTheme.warning,
  errorSurface: lightTheme.errorSurface,
  errorText: lightTheme.error,
  neutralSurface: lightTheme.surfaceMuted
} as const;

type IconName = ComponentProps<typeof Ionicons>["name"];

export function Button(props: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
  hint?: string;
}) {
  const secondary = props.variant === "secondary";
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled || props.busy}
      accessibilityRole="button"
      // An explicit name: on Android the busy state otherwise lingers in the announced description after it clears.
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: !!(props.disabled || props.busy), busy: !!props.busy }}
      accessibilityHint={props.hint}
      testID={props.testID}
      style={({ pressed }) => [
        ui.button,
        secondary && ui.buttonSecondary,
        props.variant === "danger" && ui.buttonDanger,
        (props.disabled || props.busy) && ui.disabled,
        pressed && ui.pressed
      ]}
    >
      {props.busy ? <ActivityIndicator color={secondary ? colors.brandPrimary : colors.surfaceCard} /> : null}
      {/* One line: a multi-line label sized exactly to its text can, on Android redraws, wrap its last word onto a hidden
          second line ("Ask the venue for 30" instead of "... 30 minutes"). A label too long for its button ends in "…". */}
      <Text style={[ui.buttonText, secondary && ui.buttonTextSecondary]} numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  );
}

export function Chip(props: { label: string; selected: boolean; onPress: () => void; testID?: string; disabled?: boolean }) {
  return (
    <Pressable onPress={props.onPress} disabled={props.disabled} accessibilityRole="button" accessibilityState={{ selected: props.selected, disabled: !!props.disabled }}
      testID={props.testID} style={[ui.chip, props.selected && ui.chipSelected, props.disabled && ui.disabled]}>
      <Text style={[ui.chipText, props.selected && ui.chipTextSelected]}>{props.label}</Text>
    </Pressable>
  );
}

export function Card({ children, style, title, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; title?: string; testID?: string }) {
  return (
    <View style={[ui.card, style]} testID={testID}>
      {title ? (
        <Text style={ui.cardTitle} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

const NOTICE: Record<"info" | "error" | "warning" | "success", { bg: string; icon: IconName; iconColor: string }> = {
  info: { bg: colors.noticeSurface, icon: "information-circle-outline", iconColor: colors.textPrimary },
  warning: { bg: tints.warmSurface, icon: "time-outline", iconColor: tints.warmText },
  error: { bg: tints.errorSurface, icon: "alert-circle-outline", iconColor: tints.errorText },
  success: { bg: colors.statusSuccessSurface, icon: "checkmark-circle-outline", iconColor: colors.statusSuccessText }
};

// Figma "Notice": tinted panel with an icon, a SemiBold title and muted body text.
export function Notice({ children, tone = "info", title, testID }: { children?: ReactNode; tone?: "info" | "error" | "warning" | "success"; title?: string; testID?: string }) {
  const n = NOTICE[tone];
  return (
    <View style={[ui.notice, { backgroundColor: n.bg }]} accessibilityRole={tone === "error" ? "alert" : undefined} testID={testID}>
      <Ionicons name={n.icon} size={20} color={n.iconColor} accessible={false} />
      <View style={ui.noticeBody}>
        {title ? <Text style={ui.noticeTitle}>{title}</Text> : null}
        {typeof children === "string" ? <Text style={ui.noticeText}>{children}</Text> : children}
      </View>
    </View>
  );
}

const PILL: Record<"success" | "sage" | "warm" | "danger" | "neutral", { bg: string; fg: string }> = {
  success: { bg: colors.statusSuccessSurface, fg: colors.statusSuccessText },
  sage: { bg: colors.noticeSurface, fg: colors.brandPrimary },
  warm: { bg: tints.warmSurface, fg: tints.warmText },
  danger: { bg: tints.errorSurface, fg: tints.errorText },
  neutral: { bg: tints.neutralSurface, fg: colors.textMuted }
};

// Figma "Status": tinted label with a dot; the words carry the state, so colour is not the only signal.
export function StatusPill({ label, tone = "success", testID }: { label: string; tone?: keyof typeof PILL; testID?: string }) {
  const p = PILL[tone];
  return (
    <View style={[ui.pill, { backgroundColor: p.bg }]} testID={testID}>
      <View style={[ui.pillDot, { backgroundColor: p.fg }]} />
      <Text style={[ui.pillText, { color: p.fg }]}>{label}</Text>
    </View>
  );
}

// Figma "Detail row": muted label left, value right; the total row is SemiBold and larger.
export function DetailRow({ label, value, strong, testID }: { label: string; value: string; strong?: boolean; testID?: string }) {
  return (
    <View style={ui.detailRow}>
      <Text style={[ui.detailLabel, strong && ui.detailStrongLabel]}>{label}</Text>
      <Text style={[ui.detailValue, strong && ui.detailStrongValue]} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

export function Divider() {
  return <View style={ui.divider} />;
}

// Figma "Form field": 11 px uppercase label, the control, an optional hint.
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={ui.field}>
      <Text style={ui.fieldLabel}>{label.toUpperCase()}</Text>
      {children}
      {hint ? <Text style={ui.hint}>{hint}</Text> : null}
    </View>
  );
}

// Figma "Timeline": 24 px round markers, sage when done, warm while waiting.
export function Timeline({ items }: { items: { title: string; detail?: string; done: boolean }[] }) {
  return (
    <View style={ui.timeline}>
      {items.map((item) => (
        <View key={item.title} style={ui.timelineRow}>
          <View style={[ui.marker, { backgroundColor: item.done ? colors.noticeSurface : tints.warmSurface }]}>
            <Ionicons name={item.done ? "checkmark" : "time-outline"} size={13} color={item.done ? colors.brandPrimary : tints.warmText} accessible={false} />
          </View>
          <View style={ui.timelineText}>
            <Text style={ui.timelineTitle}>{item.title}</Text>
            {item.detail ? <Text style={ui.timelineDetail}>{item.detail}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export function MockBadge({ text }: { text: string }) {
  return <StatusPill label={text} tone="neutral" />;
}

export const ui = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.surfaceCanvas, flexGrow: 1 },
  display: { fontFamily: fonts.display, fontSize: 28, lineHeight: 35, color: colors.textPrimary },
  title: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 30, color: colors.textPrimary },
  heading: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 27, color: colors.textPrimary },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 27, color: colors.textPrimary },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.textPrimary },
  muted: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.textMuted },
  small: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.textMuted },
  hint: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: colors.textMuted },
  price: { fontFamily: fonts.semibold, fontSize: 24, lineHeight: 32, color: colors.textPrimary, fontVariant: ["tabular-nums"] },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  card: { backgroundColor: colors.surfaceCard, borderColor: colors.brandSand, borderWidth: 1, borderRadius: radius.card, padding: 20, gap: spacing.base },
  notice: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start", borderRadius: radius.button, padding: spacing.base },
  noticeBody: { flex: 1, gap: spacing.xs },
  noticeTitle: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 21, color: colors.textPrimary },
  noticeText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: colors.textMuted },
  button: {
    minHeight: Math.max(48, minTouchTarget), minWidth: minTouchTarget, borderRadius: radius.button, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.base, paddingVertical: spacing.md, flexDirection: "row",
    gap: spacing.sm, borderWidth: 1, borderColor: colors.brandPrimary
  },
  buttonSecondary: { backgroundColor: colors.surfaceCard, borderColor: colors.brandSand },
  buttonDanger: { backgroundColor: colors.statusError, borderColor: colors.statusError },
  buttonText: { fontFamily: fonts.semibold, color: colors.surfaceCard, fontSize: 14, lineHeight: 20, textAlign: "center", flexShrink: 1 },
  buttonTextSecondary: { color: colors.brandPrimary },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.8 },
  chip: {
    minHeight: minTouchTarget, minWidth: minTouchTarget, paddingHorizontal: spacing.md, borderRadius: 100, borderWidth: 1, borderColor: colors.brandSand,
    backgroundColor: colors.surfaceCard, justifyContent: "center"
  },
  chipSelected: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontFamily: fonts.semibold, color: colors.textPrimary, fontSize: 12 },
  chipTextSelected: { color: colors.surfaceCard },
  pill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 5, maxWidth: "100%" },
  pillDot: { width: 5, height: 5, borderRadius: 3 },
  pillText: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 16, flexShrink: 1 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.base },
  detailLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.textMuted },
  detailValue: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 21, color: colors.textPrimary, textAlign: "right", maxWidth: "60%" },
  detailStrongLabel: { fontFamily: fonts.semibold, color: colors.textPrimary },
  detailStrongValue: { fontFamily: fonts.semibold, fontSize: 17 },
  divider: { height: 1, backgroundColor: colors.brandSand, alignSelf: "stretch" },
  field: { gap: 6 },
  fieldLabel: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 16, color: colors.textMuted, letterSpacing: 0.2 },
  input: {
    minHeight: 52, borderWidth: 1, borderColor: colors.brandSand, borderRadius: radius.button, paddingHorizontal: spacing.md,
    paddingVertical: spacing.md, fontFamily: fonts.regular, fontSize: 14, color: colors.textPrimary, backgroundColor: colors.surfaceCard
  },
  timeline: { gap: 18 },
  timelineRow: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  marker: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  timelineText: { flex: 1, gap: 3 },
  timelineTitle: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 20, color: colors.textPrimary },
  timelineDetail: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: colors.textMuted },
  badge: { alignSelf: "flex-start" },
  label: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: colors.textPrimary },
  photo: { width: "100%", borderRadius: radius.card, backgroundColor: colors.mapSurface }
});
