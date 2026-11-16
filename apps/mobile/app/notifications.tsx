// PRD-11 native inbox: in-app notifications newest first. Opening one marks it read and goes to its booking or support
// request. Native push is deferred (provider, consent and device-token design pending); the list refreshes on focus.
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { ApiError } from "@simply-sit/api-client";
import { notificationCopy, type AppNotification } from "@simply-sit/contracts";
import { colors } from "@simply-sit/design-tokens";
import { Button, Card, Notice, ui } from "../components/ui";
import { api } from "../lib/api";
import { formatIstDateTime } from "../lib/format";
import { useSession } from "../lib/session";

function openTarget(n: AppNotification) {
  if (n.ticket_id) router.push({ pathname: "/support/[id]", params: { id: n.ticket_id } });
  else if (n.booking_id && n.template.startsWith("review_")) router.push({ pathname: "/review/[bookingId]", params: { bookingId: n.booking_id } });
  else if (n.booking_id) router.push({ pathname: "/booking/[id]", params: { id: n.booking_id } });
}

export default function NotificationsScreen() {
  const { session } = useSession();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!api || !session) return;
    try {
      const page = await api.listNotifications();
      setItems(page.notifications);
      setUnread(page.unread);
      setCursor(page.next_cursor);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "NETWORK" ? e.message : "We could not load your notifications.");
    }
  }, [session]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const more = async () => {
    if (!api || !cursor) return;
    const page = await api.listNotifications(cursor);
    setItems((current) => [...(current ?? []), ...page.notifications]);
    setCursor(page.next_cursor);
  };
  const open = async (n: AppNotification) => {
    // A failed read receipt never blocks opening the item.
    if (!n.read_at && api) await api.markNotificationRead(n.notification_id).catch(() => undefined);
    openTarget(n);
  };

  if (!session) return <Notice>Sign in from the Account tab to see your notifications.</Notice>;
  return (
    <ScrollView contentContainerStyle={ui.screen}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!items && !error ? <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading notifications" /> : null}
      {unread > 0 ? (
        <Button label={`Mark all ${unread} as read`} variant="secondary" testID="mark-all-read"
          onPress={async () => {
            if (!api) return;
            await api.markAllNotificationsRead().catch(() => undefined);
            await load();
          }} />
      ) : null}
      {items && items.length === 0 ? <Notice>Nothing yet. Updates about your bookings, refunds and support requests appear here.</Notice> : null}
      {items?.map((n) => {
        const copy = notificationCopy(n);
        return (
          <Pressable key={n.notification_id} accessibilityRole="button" testID="notification"
            accessibilityLabel={`${n.read_at ? "" : "Unread. "}${copy.title}. ${copy.body}`} onPress={() => void open(n)}>
            <Card style={n.read_at ? undefined : { borderLeftWidth: 4, borderLeftColor: colors.brandPrimary }}>
              <Text style={ui.heading}>{n.read_at ? copy.title : `New: ${copy.title}`}</Text>
              <Text style={ui.body}>{copy.body}</Text>
              <Text style={ui.small}>{formatIstDateTime(n.created_at)} IST</Text>
            </Card>
          </Pressable>
        );
      })}
      {cursor ? <Button label="Older notifications" variant="secondary" onPress={() => void more()} /> : null}
    </ScrollView>
  );
}
