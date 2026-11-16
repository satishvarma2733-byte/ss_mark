// C13 native ticket: the reporter's own request and the reply from support. Private notes are never sent to the app.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, ScrollView, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { TICKET_CATEGORY_LABEL, type Ticket } from "@simply-sit/contracts";
import { colors } from "@simply-sit/design-tokens";
import { Card, Notice, ui } from "../../components/ui";
import { api } from "../../lib/api";
import { formatIstDateTime } from "../../lib/format";

const STATUS: Record<string, string> = {
  OPEN: "Received - support will look at it", IN_PROGRESS: "Support is working on it", RESOLVED: "Resolved", CLOSED: "Closed"
};

export default function TicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!api) return;
    try {
      setTicket(await api.getTicket(String(id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this request.");
    }
  }, [id]);
  useEffect(() => {
    void load();
    const sub = AppState.addEventListener("change", (s) => s === "active" && void load());
    return () => sub.remove();
  }, [load]);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!ticket) return <ActivityIndicator style={{ marginTop: 48 }} color={colors.brandPrimary} accessibilityLabel="Loading request" />;
  return (
    <ScrollView contentContainerStyle={ui.screen}>
      <Text style={ui.title}>{ticket.public_ref}</Text>
      <Text style={ui.body} testID="ticket-status">{STATUS[ticket.status] ?? ticket.status}</Text>
      <Card>
        <Text style={ui.heading}>{TICKET_CATEGORY_LABEL[ticket.category]}</Text>
        <Text style={ui.small}>
          Sent {formatIstDateTime(ticket.created_at)} IST{ticket.booking_ref ? ` · booking ${ticket.booking_ref}` : ""}{ticket.is_sensitive ? " · confidential" : ""}
        </Text>
        <Text style={ui.body}>{ticket.description}</Text>
      </Card>
      {ticket.customer_visible_resolution ? (
        <Card>
          <Text style={ui.heading}>Reply from Simply Sit</Text>
          <Text style={ui.body} testID="ticket-resolution">{ticket.customer_visible_resolution}</Text>
        </Card>
      ) : null}
    </ScrollView>
  );
}
