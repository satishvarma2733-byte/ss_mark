// C13 native - Figma "A · Customer mobile · Create support ticket". Optionally linked to one of the customer's
// bookings (?bookingId=). Attachments are not supported yet. Tickets are private to the reporter.
import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ApiError } from "@simply-sit/api-client";
import { TICKET_CATEGORIES, TICKET_CATEGORY_LABEL, type BookingDetail } from "@simply-sit/contracts";
import { colors } from "@simply-sit/design-tokens";
import { Button, Card, Chip, Field, Notice, StatusPill, ui } from "../../components/ui";
import { Screen } from "../../components/shell";
import { BookingIdentity } from "../../components/booking";
import { api } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/session";

export default function NewTicketScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId?: string }>();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [category, setCategory] = useState<(typeof TICKET_CATEGORIES)[number]>(bookingId ? "BOOKING" : "OTHER");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());

  useEffect(() => {
    if (!api || !bookingId) return;
    void api.getBooking(String(bookingId)).then(setBooking, () => setBooking(null));
  }, [bookingId]);

  async function send() {
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      const ticket = await api.createTicket(
        { category, description: description.trim(), ...(booking ? { booking_id: booking.booking_id } : {}) },
        key.current
      );
      key.current = newIdempotencyKey();
      router.replace({ pathname: "/support/[id]", params: { id: ticket.ticket_id } });
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "NETWORK")) key.current = newIdempotencyKey();
      setError(e instanceof Error ? e.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Create a support ticket" subtitle={booking ? booking.public_ref : "Simply Sit support"} back nav="help">
      {booking ? (
        <BookingIdentity booking={booking}>
          <StatusPill label={booking.status.replace("_", " ").toLowerCase()} tone="sage" />
        </BookingIdentity>
      ) : null}
      <Card title="Tell us what happened">
        <Field label="Associated booking">
          <Text style={ui.input}>{booking ? booking.public_ref : "Not about a booking"}</Text>
        </Field>
        <Field label="Category">
          <View style={ui.row}>
            {TICKET_CATEGORIES.map((c) => (
              <Chip key={c} label={TICKET_CATEGORY_LABEL[c]} selected={category === c} onPress={() => setCategory(c)} testID={`ticket-${c}`} />
            ))}
          </View>
        </Field>
        {category === "SAFETY" ? <Text style={ui.hint}>Safety reports are confidential: only senior support staff can read them.</Text> : null}
        <Field label="Description" hint="At least 10 characters. Screenshots can’t be attached yet.">
          <TextInput value={description} onChangeText={setDescription} placeholder="What happened?" placeholderTextColor={colors.textMuted} multiline
            maxLength={5000} accessibilityLabel="What happened?" testID="ticket-description" style={[ui.input, { minHeight: 110, textAlignVertical: "top" }]} />
        </Field>
      </Card>
      <Notice title="Keep private information safe">
        Never include a UPI PIN, OTP, password, full card number or bank details. Your booking reference is enough to begin.
      </Notice>
      <Text style={ui.small}>Replies appear in your support case. Refunds aren’t credited until the payment provider confirms.</Text>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button label="Submit support ticket" onPress={() => void send()} busy={busy} disabled={busy || description.trim().length < 10} testID="ticket-send" />
      {booking ? <Button label="Back to booking" variant="secondary" onPress={() => router.back()} /> : null}
    </Screen>
  );
}
