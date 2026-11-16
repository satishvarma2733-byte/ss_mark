// C09 native: own upcoming and past bookings. Re-fetched on focus and when the app returns to the foreground, so a
// payment finished in the browser (or after a restart) shows its server state here.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Pressable, RefreshControl, ScrollView, Text } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { ApiError } from "@simply-sit/api-client";
import type { BookingSummary } from "@simply-sit/contracts";
import { colors } from "@simply-sit/design-tokens";
import { Button, Card, Chip, MockBadge, Notice, ui } from "../../components/ui";
import { api } from "../../lib/api";
import { formatInrPaise, formatIstDateTime, formatIstTime } from "../../lib/format";
import { useSession } from "../../lib/session";

const STATUS: Record<string, string> = {
  HOLD: "Held - payment needed", PENDING_PAYMENT: "Held - payment in progress", CONFIRMED: "Confirmed", CHECKED_IN: "Checked in",
  COMPLETED: "Completed", CANCELLED: "Cancelled", EXPIRED: "Hold ended", NO_SHOW: "Missed (no-show)"
};
const label = (b: BookingSummary) => ((b.status === "HOLD" || b.status === "PENDING_PAYMENT") && !b.hold_active ? "Hold ended" : STATUS[b.status] ?? b.status);

export default function BookingsScreen() {
  const { ready, session } = useSession();
  const [scope, setScope] = useState<"upcoming" | "past">("upcoming");
  const [bookings, setBookings] = useState<BookingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!api || !session) return;
    try {
      setBookings((await api.listBookings(scope)).bookings);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "NETWORK" ? e.message : "We could not load your bookings.");
    }
  }, [scope, session]);

  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && void load());
    return () => sub.remove();
  }, [load]);

  if (!ready) return <ActivityIndicator style={{ marginTop: 48 }} color={colors.brandPrimary} />;
  if (!session) {
    return (
      <ScrollView contentContainerStyle={ui.screen}>
        <Text style={ui.title}>Your bookings</Text>
        <Text style={ui.muted}>Sign in to see your reservations, receipts and check-in codes.</Text>
        <Button label="Sign in" onPress={() => router.push("/account")} />
      </ScrollView>
    );
  }
  return (
    <ScrollView contentContainerStyle={ui.screen}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Text style={ui.title}>Your bookings</Text>
      <Button label="Notifications" variant="secondary" testID="open-notifications" onPress={() => router.push("/notifications")} />
      <ScrollView horizontal contentContainerStyle={ui.row}>
        <Chip label="Upcoming" selected={scope === "upcoming"} onPress={() => setScope("upcoming")} />
        <Chip label="Past and cancelled" selected={scope === "past"} onPress={() => setScope("past")} />
      </ScrollView>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!bookings && !error ? <ActivityIndicator color={colors.brandPrimary} /> : null}
      {bookings && bookings.length === 0 ? (
        <Notice>
          <Text style={ui.body}>{scope === "upcoming" ? "No upcoming bookings." : "No past bookings yet."}</Text>
          <Button label="Find a space" variant="secondary" onPress={() => router.push("/")} />
        </Notice>
      ) : null}
      {bookings?.map((b) => (
        <Pressable key={b.booking_id} accessibilityRole="button" testID="booking-card"
          onPress={() => (b.status === "HOLD" || b.status === "PENDING_PAYMENT") && b.hold_active
            ? router.push({ pathname: "/checkout/[bookingId]", params: { bookingId: b.booking_id } })
            : router.push({ pathname: "/booking/[id]", params: { id: b.booking_id } })}>
          <Card>
            {b.venue.is_synthetic ? <MockBadge text="Synthetic demo" /> : null}
            <Text style={ui.heading}>{b.venue.name}</Text>
            <Text style={ui.body}>
              {formatIstDateTime(b.start_at)} - {formatIstTime(b.end_at)} IST
            </Text>
            <Text style={ui.small}>
              {b.public_ref} · {b.table.label} · {formatInrPaise(b.total_paise)}
            </Text>
            <Text style={[ui.body, { fontWeight: "700" }]} testID="booking-status">
              {label(b)}
              {b.refunds.length > 0 ? ` · Refund ${b.refunds.at(-1)!.status.toLowerCase()}` : ""}
            </Text>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}
