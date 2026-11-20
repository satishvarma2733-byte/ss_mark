// C13 native ticket - Figma "A · Customer mobile · Support case detail" (94:11240): the reporter's own request, where it
// stands, and the reply from support. Private notes are never sent to the app. The API has no customer reply yet, so
// the conversation is read-only (the frame's message box is not built).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { TICKET_CATEGORY_LABEL, type Ticket } from "@simply-sit/contracts";
import { colors, radius, spacing } from "@simply-sit/design-tokens";
import { Screen } from "../../components/shell";
import { Card, DetailRow, Notice, StatusPill, tints, ui } from "../../components/ui";
import { api } from "../../lib/api";
import { formatIstDateTime } from "../../lib/format";

const STATUS: Record<Ticket["status"], { label: string; tone: "warm" | "sage" | "success" | "neutral" }> = {
  OPEN: { label: "Open · Awaiting support", tone: "warm" },
  IN_PROGRESS: { label: "In progress · Support is working on it", tone: "sage" },
  RESOLVED: { label: "Resolved", tone: "success" },
  CLOSED: { label: "Closed", tone: "neutral" }
};
// Plain status sentence kept for tests and screen readers (testID ticket-status).
const STATUS_TEXT: Record<string, string> = {
  OPEN: "Received - support will look at it", IN_PROGRESS: "Support is working on it", RESOLVED: "Resolved", CLOSED: "Closed"
};

function Step({ done, title, detail }: { done: boolean; title: string; detail: string }) {
  return (
    <View style={s.step}>
      <View style={[s.stepIcon, done ? s.stepDone : s.stepWait]}>
        <Ionicons name={done ? "checkmark" : "time-outline"} size={14} color={done ? colors.statusSuccess : tints.warmText} accessible={false} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={ui.label}>{title}</Text>
        <Text style={ui.small}>{detail}</Text>
      </View>
    </View>
  );
}

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
    const sub = AppState.addEventListener("change", (st) => st === "active" && void load());
    return () => sub.remove();
  }, [load]);

  if (error || !ticket) {
    return (
      <Screen title="Your support case" back nav="help">
        {error ? <Notice tone="error">{error}</Notice> : <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading request" />}
      </Screen>
    );
  }
  const status = STATUS[ticket.status];
  const answered = !!ticket.customer_visible_resolution;
  const done = ticket.status === "RESOLVED" || ticket.status === "CLOSED";
  return (
    <Screen title="Your support case" subtitle={`${ticket.public_ref} · Submitted ${formatIstDateTime(ticket.created_at)} IST`} back nav="help">
      <View style={{ gap: spacing.sm }}>
        <StatusPill tone={status.tone} label={status.label} />
        <Text style={s.srOnly} testID="ticket-status">{STATUS_TEXT[ticket.status] ?? ticket.status}</Text>
      </View>

      <Card title={TICKET_CATEGORY_LABEL[ticket.category]}>
        {ticket.booking_ref ? <DetailRow label="Booking" value={ticket.booking_ref} /> : null}
        {ticket.venue_name ? <DetailRow label="Venue" value={ticket.venue_name} /> : null}
        <DetailRow label="Case" value={ticket.public_ref} />
        {ticket.is_sensitive ? <Text style={ui.small}>Marked confidential: only the support team can see it.</Text> : null}
      </Card>

      <Card title="What happens next">
        <Step done title="Request received" detail={`${formatIstDateTime(ticket.created_at)} IST · ${ticket.public_ref}`} />
        <Step done={ticket.status !== "OPEN"} title="Support review"
          detail={ticket.status === "OPEN" ? "Waiting for the support team to pick it up." : "The support team has looked at your request."} />
        <Step done={done || answered} title={done ? "Resolved" : "We’ll update you here"}
          detail={done && ticket.resolved_at ? `${formatIstDateTime(ticket.resolved_at)} IST` : "No further action is needed now. Please don’t open a duplicate request."} />
      </Card>

      <Card title="Conversation">
        <View style={s.message}>
          <Text style={ui.small}>{`You · ${formatIstDateTime(ticket.created_at)} IST`}</Text>
          <Text style={ui.body}>{ticket.description}</Text>
        </View>
        {answered ? (
          <View style={[s.message, s.reply]}>
            <Text style={ui.small}>{`Simply Sit${ticket.resolved_at ? ` · ${formatIstDateTime(ticket.resolved_at)} IST` : ""}`}</Text>
            <Text style={ui.body} testID="ticket-resolution">{ticket.customer_visible_resolution}</Text>
          </View>
        ) : (
          <Text style={ui.small}>Support will reply here. You will also get a notification.</Text>
        )}
      </Card>

      <Notice title="No OTP or UPI PIN needed">
        <Text style={ui.noticeText}>Support can track this using your case and booking references. Never share a one-time code or payment PIN.</Text>
      </Notice>
    </Screen>
  );
}

const s = StyleSheet.create({
  srOnly: { position: "absolute", width: 1, height: 1, opacity: 0 },
  step: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  stepIcon: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  stepDone: { backgroundColor: colors.statusSuccessSurface },
  stepWait: { backgroundColor: tints.warmSurface },
  message: { gap: 4, padding: spacing.md, borderRadius: radius.card, backgroundColor: colors.surfaceCanvas },
  reply: { backgroundColor: colors.statusSuccessSurface }
});
