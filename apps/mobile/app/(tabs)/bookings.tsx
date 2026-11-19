// C09 native: own bookings - Figma "Customer · My bookings" (94:10467). Upcoming, completed and cancelled tabs with
// counts; the API has upcoming and past lists, and past is split here by status. Re-fetched on focus and when the app
// returns to the foreground, so a payment finished in the browser (or after a restart) shows its server state here.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { ApiError } from "@simply-sit/api-client";
import { refundStatusText, type BookingSummary } from "@simply-sit/contracts";
import { colors, spacing } from "@simply-sit/design-tokens";
import { Screen } from "../../components/shell";
import { Button, Card, Chip, DetailRow, Divider, MockBadge, Notice, StatusPill, fonts, ui } from "../../components/ui";
import { api } from "../../lib/api";
import { formatInrPaise, formatIstDate, formatIstTime } from "../../lib/format";
import { useSession } from "../../lib/session";

type Tab = "upcoming" | "completed" | "cancelled";
type Tone = "success" | "sage" | "warm" | "neutral" | "danger";

const isHeld = (b: BookingSummary) => b.status === "HOLD" || b.status === "PENDING_PAYMENT";
const isCancelled = (b: BookingSummary) => b.status === "CANCELLED" || b.status === "EXPIRED" || (isHeld(b) && !b.hold_active);
const guests = (n: number) => `${n} ${n === 1 ? "guest" : "guests"}`;
const timeRange = (b: BookingSummary) => `${formatIstTime(b.start_at)}–${formatIstTime(b.end_at)}`;

// Plain status word, kept for tests and screen readers (testID booking-status).
function statusWord(b: BookingSummary): string {
  if (isHeld(b)) return b.hold_active ? (b.status === "HOLD" ? "Held - payment needed" : "Held - payment in progress") : "Hold ended";
  const words: Record<string, string> = {
    CONFIRMED: "Confirmed", CHECKED_IN: "Checked in", COMPLETED: "Completed", CANCELLED: "Cancelled", EXPIRED: "Hold ended",
    NO_SHOW: "Missed (no-show)"
  };
  return words[b.status] ?? b.status;
}

function pill(b: BookingSummary): { label: string; tone: Tone } {
  const today = formatIstDate(b.start_at) === formatIstDate(b.server_now);
  const refund = b.refunds.at(-1);
  if (isHeld(b)) return b.hold_active ? { label: "On hold · Payment required", tone: "warm" } : { label: "Hold ended", tone: "neutral" };
  switch (b.status) {
    case "CONFIRMED": return { label: today ? "Confirmed · Today" : "Confirmed", tone: "success" };
    case "CHECKED_IN": return { label: "Checked in", tone: "success" };
    case "COMPLETED": return { label: "Completed", tone: "sage" };
    case "NO_SHOW": return { label: "Missed (no-show)", tone: "danger" };
    case "EXPIRED": return { label: "Hold ended", tone: "neutral" };
    case "CANCELLED":
      return refund
        ? { label: `Cancelled · ${refund.status === "PROCESSED" ? "Refunded" : "Refund pending"}`, tone: refund.status === "PROCESSED" ? "neutral" : "warm" }
        : { label: "Cancelled", tone: "neutral" };
    default: return { label: statusWord(b), tone: "neutral" };
  }
}

const openBooking = (b: BookingSummary) =>
  isHeld(b) && b.hold_active
    ? router.push({ pathname: "/checkout/[bookingId]", params: { bookingId: b.booking_id } })
    : router.push({ pathname: "/booking/[id]", params: { id: b.booking_id } });

function Link({ label, onPress, icon }: { label: string; onPress: () => void; icon?: "arrow-forward" | "open-outline" }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" hitSlop={10} style={s.link}>
      <Text style={s.linkText}>{label}</Text>
      {icon ? <Ionicons name={icon} size={13} color={colors.brandPrimary} accessible={false} /> : null}
    </Pressable>
  );
}

function Status({ b }: { b: BookingSummary }) {
  const p = pill(b);
  return (
    <>
      <StatusPill tone={p.tone} label={p.label} />
      <Text style={s.srOnly} testID="booking-status">{statusWord(b)}</Text>
    </>
  );
}

function UpcomingCard({ b }: { b: BookingSummary }) {
  const held = isHeld(b);
  const action = held ? "Complete payment" : b.status === "CHECKED_IN" ? "View booking" : "View pass & check in";
  return (
    <Card testID="booking-card">
      <Status b={b} />
      {b.venue.is_synthetic ? <MockBadge text="Synthetic demo" /> : null}
      <Pressable onPress={() => openBooking(b)} accessibilityRole="button" accessibilityLabel={`${b.venue.name}, ${statusWord(b)}`} style={{ gap: 2 }}>
        <Text style={ui.cardTitle}>{b.venue.name}</Text>
        <Text style={ui.small}>{`${b.table.label} · ${guests(b.party_size)}`}</Text>
        <Text style={ui.small}>{b.public_ref}</Text>
      </Pressable>
      <Divider />
      <DetailRow label={`${formatIstDate(b.start_at)} · IST`} value={timeRange(b)} />
      <DetailRow label={held ? "To pay" : b.payment?.payment_state === "CAPTURED" ? "Paid" : "Total"} value={formatInrPaise(b.total_paise)} strong />
      <Button label={action} onPress={() => openBooking(b)} />
      {held ? null : (
        <View style={s.links}>
          <Link label="Directions" icon="open-outline"
            onPress={() => void Linking.openURL(`https://www.openstreetmap.org/?mlat=${b.venue.lat}&mlon=${b.venue.lng}#map=17/${b.venue.lat}/${b.venue.lng}`)} />
          <Link label="Receipt" onPress={() => openBooking(b)} />
          <Link label="Manage" onPress={() => openBooking(b)} />
        </View>
      )}
    </Card>
  );
}

function CompletedCard({ b }: { b: BookingSummary }) {
  return (
    <Card testID="booking-card">
      <View style={s.statusRow}>
        <Status b={b} />
        <Text style={ui.small}>{formatIstDate(b.start_at)}</Text>
      </View>
      <Text style={ui.cardTitle}>{b.venue.name}</Text>
      <Text style={ui.small}>{`${b.table.label} · ${guests(b.party_size)} · ${timeRange(b)} IST`}</Text>
      <DetailRow label={b.public_ref} value={formatInrPaise(b.total_paise)} strong />
      <View style={s.actions}>
        {b.status === "COMPLETED" ? (
          <View style={{ flex: 1 }}>
            <Button label={b.review ? "Your review" : "Write a review"} variant="secondary"
              onPress={() => router.push({ pathname: "/review/[bookingId]", params: { bookingId: b.booking_id } })} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Button label="Receipt" variant="secondary" onPress={() => openBooking(b)} />
        </View>
      </View>
      {b.status === "COMPLETED" && !b.review ? <Text style={ui.small}>Reviews are available only after a completed stay.</Text> : null}
    </Card>
  );
}

function CancelledCard({ b }: { b: BookingSummary }) {
  const refund = b.refunds.at(-1);
  return (
    <Card testID="booking-card">
      <Status b={b} />
      <Text style={ui.cardTitle}>{b.venue.name}</Text>
      <Text style={ui.small}>{`${formatIstDate(b.start_at)} · ${timeRange(b)} · ${b.public_ref}`}</Text>
      {refund ? (
        <>
          <DetailRow label="Refund to original payment method" value={formatInrPaise(refund.amount_paise)} strong />
          <Text style={ui.small}>{`Refund ${refundStatusText(refund.status)}.`}</Text>
        </>
      ) : (
        <Text style={ui.small}>{b.confirmed_at ? "No refund applies to this booking." : "Nothing was charged for this hold."}</Text>
      )}
      <Link label={refund ? "Track refund & get help" : "View details"} icon="arrow-forward" onPress={() => openBooking(b)} />
    </Card>
  );
}

export default function BookingsScreen() {
  const { ready, session } = useSession();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [upcoming, setUpcoming] = useState<BookingSummary[] | null>(null);
  const [past, setPast] = useState<BookingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!api || !session) return;
    try {
      const [u, p] = await Promise.all([api.listBookings("upcoming"), api.listBookings("past")]);
      setUpcoming(u.bookings);
      setPast(p.bookings);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "NETWORK" ? e.message : "We could not load your bookings.");
    }
  }, [session]);

  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => st === "active" && void load());
    return () => sub.remove();
  }, [load]);

  if (!ready) {
    return (
      <Screen title="Your hours, in one place">
        <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading" />
      </Screen>
    );
  }
  if (!session) {
    return (
      <Screen title="Your hours, in one place">
        <Notice title="Sign in to see your bookings">
          <Text style={ui.noticeText}>Your reservations, receipts and check-in codes appear here once you sign in.</Text>
        </Notice>
        <Button label="Sign in" onPress={() => router.push("/account")} />
      </Screen>
    );
  }

  // Upcoming soonest first; history most recent first.
  const up = upcoming?.filter((b) => !isCancelled(b)).sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at)) ?? null;
  const done = past?.filter((b) => !isCancelled(b)).sort((a, b) => Date.parse(b.start_at) - Date.parse(a.start_at)) ?? null;
  const cancelled = past && upcoming
    ? [...past, ...upcoming].filter(isCancelled).sort((a, b) => Date.parse(b.start_at) - Date.parse(a.start_at))
    : null;
  const lists: Record<Tab, BookingSummary[] | null> = { upcoming: up, completed: done, cancelled };
  const list = lists[tab];
  const count = (t: Tab) => (lists[t] ? ` · ${lists[t]!.length}` : "");
  const heading: Record<Tab, string> = { upcoming: "Up next", completed: "Recently completed", cancelled: "Cancelled" };
  const empty: Record<Tab, string> = {
    upcoming: "No upcoming bookings. Find a calm table for your next hour.",
    completed: "No completed visits yet.",
    cancelled: "No cancelled bookings."
  };

  return (
    <Screen title="Your hours, in one place" refreshing={refreshing}
      onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <View style={s.tabs}>
        <Chip label={`Upcoming${count("upcoming")}`} selected={tab === "upcoming"} onPress={() => setTab("upcoming")} testID="tab-upcoming" />
        <Chip label={`Completed${count("completed")}`} selected={tab === "completed"} onPress={() => setTab("completed")} testID="tab-completed" />
        <Chip label={`Cancelled${count("cancelled")}`} selected={tab === "cancelled"} onPress={() => setTab("cancelled")} testID="tab-cancelled" />
      </View>

      <View style={s.sectionHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={ui.heading} accessibilityRole="header">{heading[tab]}</Text>
          {tab === "upcoming" && up?.[0] ? <Text style={ui.small}>{formatIstDate(up[0].start_at)}</Text> : null}
        </View>
        <Pressable onPress={() => router.push("/notifications")} accessibilityRole="button" accessibilityLabel="Notifications"
          testID="open-notifications" hitSlop={8} style={s.bell}>
          <Ionicons name="notifications-outline" size={22} color={colors.brandPrimary} accessible={false} />
        </Pressable>
      </View>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {!list && !error ? <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading bookings" /> : null}
      {list && list.length === 0 ? (
        <Notice>
          <Text style={ui.noticeText}>{empty[tab]}</Text>
          {tab === "upcoming" ? <Button label="Find a space" variant="secondary" onPress={() => router.navigate("/")} /> : null}
        </Notice>
      ) : null}
      {list?.map((b) =>
        tab === "upcoming" ? <UpcomingCard key={b.booking_id} b={b} />
        : tab === "completed" ? <CompletedCard key={b.booking_id} b={b} />
        : <CancelledCard key={b.booking_id} b={b} />
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: -spacing.sm },
  bell: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  actions: { flexDirection: "row", gap: spacing.md },
  links: { flexDirection: "row", justifyContent: "space-between" },
  link: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32 },
  linkText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.brandPrimary },
  srOnly: { position: "absolute", width: 1, height: 1, opacity: 0 }
});
