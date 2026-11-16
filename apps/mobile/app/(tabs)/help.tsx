// C13 native: help. Emergency guidance first, common answers, then the customer's own support requests and a form to
// raise one. Tickets are private to the person who raised them; Simply Sit support replies on the ticket.
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { ApiError } from "@simply-sit/api-client";
import { EMERGENCY_NUMBER, TICKET_CATEGORIES, TICKET_CATEGORY_LABEL, type Ticket } from "@simply-sit/contracts";
import { colors, radius, spacing } from "@simply-sit/design-tokens";
import { Button, Card, Chip, Notice, ui } from "../../components/ui";
import { api } from "../../lib/api";
import { newIdempotencyKey, useSession } from "../../lib/session";

const FAQ = [
  ["When do I get my refund?", "Refunds go back to the original payment method. Your booking shows 'in progress' until the payment provider confirms it."],
  ["Can I bring my own food?", "It depends on the venue. Each venue and booking shows its food and delivery rules."],
  ["Can I stay longer?", "While you are checked in, use 'Need more time?' on your booking. Staff answer within five minutes."]
] as const;

export default function HelpScreen() {
  const { ready, session } = useSession();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [category, setCategory] = useState<(typeof TICKET_CATEGORIES)[number]>("BOOKING");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const key = useRef(newIdempotencyKey());

  const load = useCallback(async () => {
    if (!api || !session) return;
    try {
      setTickets(await api.listTickets());
    } catch {
      // The list is secondary; the form still works.
    }
  }, [session]);
  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));
  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    if (!api) return;
    setBusy(true);
    setMessage(null);
    try {
      const ticket = await api.createTicket({ category, description: description.trim() }, key.current);
      key.current = newIdempotencyKey();
      setDescription("");
      router.push({ pathname: "/support/[id]", params: { id: ticket.ticket_id } });
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "NETWORK")) key.current = newIdempotencyKey();
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not send." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={ui.screen}>
      <Notice tone="warning">{`In an emergency, call ${EMERGENCY_NUMBER} or ask venue staff for help right away. Support requests here are not monitored for emergencies.`}</Notice>
      <Card>
        <Text style={ui.heading}>Common questions</Text>
        {FAQ.map(([q, a]) => (
          <View key={q} style={{ gap: 2 }}>
            <Text style={[ui.body, { fontWeight: "600" }]}>{q}</Text>
            <Text style={ui.small}>{a}</Text>
          </View>
        ))}
      </Card>
      {!ready ? null : !session ? (
        <Button label="Sign in to contact support" onPress={() => router.push("/account")} />
      ) : (
        <>
          <Card>
            <Text style={ui.heading}>Contact support</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {TICKET_CATEGORIES.map((c) => (
                <Chip key={c} label={TICKET_CATEGORY_LABEL[c]} selected={category === c} onPress={() => setCategory(c)} testID={`ticket-${c}`} />
              ))}
            </View>
            {category === "SAFETY" ? <Text style={ui.small}>Safety reports are confidential: only senior support staff can read them.</Text> : null}
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="What happened? (at least 10 characters)"
              multiline
              maxLength={5000}
              accessibilityLabel="What happened?"
              testID="ticket-description"
              style={{ minHeight: 96, borderWidth: 1, borderColor: colors.brandSand, borderRadius: radius.button, padding: spacing.sm,
                       color: colors.textPrimary, backgroundColor: colors.surfaceCard, textAlignVertical: "top" }}
            />
            <Button label="Send" onPress={() => void send()} busy={busy} disabled={busy || description.trim().length < 10} testID="ticket-send" />
            {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          </Card>
          <Card>
            <Text style={ui.heading}>Your requests</Text>
            {tickets.length === 0 ? <Text style={ui.small}>No requests yet.</Text> : tickets.map((t) => (
              <Button key={t.ticket_id} variant="secondary" label={`${t.public_ref} · ${TICKET_CATEGORY_LABEL[t.category]} · ${t.status.replace("_", " ").toLowerCase()}`}
                onPress={() => router.push({ pathname: "/support/[id]", params: { id: t.ticket_id } })} />
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}
