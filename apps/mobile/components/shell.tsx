// Screen chrome from the Figma "A/B/G · Customer mobile" frames: olive brand header (supplied monogram, name, account
// shortcut), a page title bar, scrolling content and the four-item primary navigation. Tab screens get the navigation
// from the tab bar; stack screens (booking, checkout, support ...) render it themselves so every screen has it.
import Ionicons from "@expo/vector-icons/Ionicons";
import type { BottomTabBarProps } from "expo-router/build/layouts/Tabs";
import { router } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@simply-sit/design-tokens";
import monogramCream from "../assets/brand/monogram-cream.png";
import { fonts, minTouchTarget } from "./ui";

export type NavKey = "index" | "bookings" | "help" | "account";
type IconName = ComponentProps<typeof Ionicons>["name"];

const NAV: { key: NavKey; label: string; icon: IconName; href: string }[] = [
  { key: "index", label: "Discover", icon: "compass-outline", href: "/" },
  { key: "bookings", label: "Bookings", icon: "ticket-outline", href: "/bookings" },
  { key: "help", label: "Help", icon: "help-circle-outline", href: "/help" },
  { key: "account", label: "Account", icon: "person-outline", href: "/account" }
];

export function BrandHeader() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[shell.header, { paddingTop: insets.top }]}>
      <View style={shell.headerRow}>
        <View style={shell.brand} accessible accessibilityRole="header" accessibilityLabel="Simply Sit. Your Space. Your Time.">
          <Image source={monogramCream} style={shell.monogram} resizeMode="contain" accessible={false} />
          <View>
            <Text style={shell.brandName}>SIMPLY SIT</Text>
            <Text style={shell.brandTag}>Your Space. Your Time.</Text>
          </View>
        </View>
        <Pressable onPress={() => router.navigate("/account")} accessibilityRole="button" accessibilityLabel="Account" style={shell.headerIcon} hitSlop={8}>
          <Ionicons name="person-circle-outline" size={26} color={colors.surfaceCanvas} accessible={false} />
        </Pressable>
      </View>
    </View>
  );
}

export function PageNav({ title, subtitle, back }: { title: string; subtitle?: string; back?: boolean }) {
  return (
    <View style={shell.pageNav}>
      {back && router.canGoBack() ? (
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" style={shell.back} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} accessible={false} />
        </Pressable>
      ) : null}
      <View style={shell.pageNavText}>
        <Text style={shell.pageTitle} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={shell.pageSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

export function PrimaryNav({ active, onNavigate }: { active?: NavKey; onNavigate?: (key: NavKey, href: string) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[shell.nav, { paddingBottom: 22 + Math.max(0, insets.bottom - 8) }]} accessibilityRole="tablist">
      {NAV.map((item) => {
        const selected = item.key === active;
        return (
          <Pressable
            key={item.key}
            onPress={() => (onNavigate ? onNavigate(item.key, item.href) : router.navigate(item.href as never))}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={item.label}
            style={shell.navItem}
          >
            <Ionicons name={item.icon} size={21} color={selected ? colors.brandPrimary : colors.textPrimary} accessible={false} />
            <Text style={[shell.navLabel, selected && shell.navLabelActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Tab bar for expo-router Tabs: the same primary navigation, driven by the navigator state.
export function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const active = state.routes[state.index]?.name as NavKey | undefined;
  return (
    <PrimaryNav
      active={active}
      onNavigate={(key) => {
        const route = state.routes.find((r) => r.name === key);
        if (route) navigateToTab(route.key);
      }}
    />
  );
}

export function Screen(props: {
  title: string;
  subtitle?: string;
  back?: boolean;
  // Stack screens pass the section they belong to; tab screens leave it out (the tab bar is drawn by the navigator).
  nav?: NavKey;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  testID?: string;
}) {
  return (
    <View style={shell.root} testID={props.testID}>
      <BrandHeader />
      <ScrollView
        contentContainerStyle={shell.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={props.onRefresh ? <RefreshControl refreshing={!!props.refreshing} onRefresh={props.onRefresh} /> : undefined}
      >
        <PageNav title={props.title} subtitle={props.subtitle} back={props.back} />
        <View style={shell.content}>{props.children}</View>
      </ScrollView>
      {props.nav ? <PrimaryNav active={props.nav} /> : null}
    </View>
  );
}

const shell = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceCanvas },
  header: { backgroundColor: colors.brandPrimary },
  headerRow: { height: 72, paddingHorizontal: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  monogram: { width: 40, height: 30 },
  brandName: { fontFamily: fonts.semibold, fontSize: 17, letterSpacing: 1, color: colors.surfaceCanvas },
  brandTag: { fontFamily: fonts.regular, fontSize: 9, color: colors.surfaceCanvas },
  headerIcon: { minWidth: minTouchTarget, minHeight: minTouchTarget, alignItems: "flex-end", justifyContent: "center" },
  scroll: { flexGrow: 1 },
  pageNav: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingTop: 24, paddingBottom: 4, paddingHorizontal: 24 },
  back: { minWidth: 40, minHeight: minTouchTarget, justifyContent: "center", marginLeft: -8, marginTop: -12 },
  pageNavText: { flex: 1, gap: 4 },
  pageTitle: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 27, color: colors.textPrimary },
  pageSubtitle: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: colors.textMuted },
  content: { padding: 24, gap: 24 },
  nav: {
    flexDirection: "row", justifyContent: "space-between", backgroundColor: colors.surfaceCard, borderTopWidth: 1,
    borderTopColor: colors.brandSand, paddingTop: 15, paddingHorizontal: 20
  },
  navItem: { width: 76, minHeight: minTouchTarget, alignItems: "center", gap: 7 },
  navLabel: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 15, color: colors.textPrimary, textAlign: "center" },
  navLabelActive: { fontFamily: fonts.semibold }
});
