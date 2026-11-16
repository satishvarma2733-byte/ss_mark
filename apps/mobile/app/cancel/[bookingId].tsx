// C10 native: cancel a confirmed booking. The refund shown is the server's preview; confirming sends it back, and if
// the database clock now gives a different refund (the cutoff passed) nothing is cancelled and the new amount is shown.
// One Idempotency-Key per confirmation, so a retry after a lost response cannot cancel or refund twice.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { ApiError } from "@simply-sit/api-client";
import {
  CUSTOMER_CANCEL_REASONS, CUSTOMER_CANCEL_REASON_LABEL, cancellationPolicySummary, type BookingDetail, type CancelPreview,
  type CustomerCancelReason
} from "@simply-sit/contracts";
import { colors } from "@simply-sit/design-tokens";
import { Button, Card, Chip, MockBadge, Notice, ui } from "../../components/ui";
import { api } from "../../lib/api";
import { formatInrPaise, formatIstDateTime, formatIstTime } from "../../lib/format";
import { newIdempotencyKey } from "../../lib/session";

type Terms = Pick<CancelPreview, "window" | "refund_paise" | "retained_paise" | "captured_paise" | "terms_change_at">;

export default function CancelScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [version, setVersion] = useState(0);
  const [reason, setReason] = useState<CustomerCancelReason | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "warning" | "error"; text: string } | null>(null);
  const [blocked, setBlocked] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    try {
      const [b, p] = await Promise.all([api.getBooking(String(bookingId)), api.cancelPreview(String(bookingId))]);
      setBooking(b);
      setTerms(p);
      setVersion(p.booking_version);
    } catch (e) {
      setBlocked(true);
      setMessage({
        tone: "error",
        text: e instanceof ApiError && e.code === "INVALID_TRANSITION"
          ? "This booking can no longer be cancelled (it may have started, been checked in or already been cancelled)."
          : e instanceof Error ? e.message : "Could not load the cancellation terms."
      });
    }
  }, [bookingId]);
  useEffect(() => {
    void load();
  }, [load]);

  // Back to this booking's screen: pops to it when it is below in the stack, otherwise replaces this screen with it
  // (for example when the cancel screen was opened from a link on top of another booking).
  const toBooking = () => router.dismissTo({ pathname: "/booking/[id]", params: { id: String(bookingId) } });

  function chooseReason(next: CustomerCancelReason) {
    setReason((current) => (current === next ? null : next));
    setKey(newIdempotencyKey()); // a different request body is a different action
  }

  async function confirm() {
    if (!api || !terms) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.cancelBooking(String(bookingId), {
        expected_version: version, expected_refund_paise: terms.refund_paise, ...(reason ? { reason_code: reason } : {})
      }, key);
      toBooking(); // the booking screen reloads on focus and shows the cancellation and refund state
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.code === "CANCELLATION_CHANGED") {
        const next = e.details as unknown as Terms & { booking_version: number };
        setTerms(next);
        setVersion(next.booking_version);
        setKey(newIdempotencyKey());
        setMessage({ tone: "warning", text: "The refund has changed because the cancellation deadline passed. Check the new amount and confirm again." });
      } else if (e instanceof ApiError && (e.code === "STALE_VERSION" || e.code === "INVALID_TRANSITION")) {
        setBlocked(true);
        setMessage({ tone: "error", text: "This booking can no longer be cancelled (it may have started, been checked in or already been cancelled)." });
      } else {
        // Offline or server trouble: retrying reuses the same key, so the cancellation happens at most once.
        setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not cancel. Try again." });
      }
    }
  }

  if (!booking || !terms) {
    return (
      <ScrollView contentContainerStyle={ui.screen}>
        <Stack.Screen options={{ title: "Cancel booking" }} />
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : <ActivityIndicator style={{ marginTop: 48 }} color={colors.brandPrimary} accessibilityLabel="Loading cancellation terms" />}
        {blocked ? <Button label="Back to booking" variant="secondary" onPress={toBooking} /> : null}
      </ScrollView>
    );
  }
  return (
    <ScrollView contentContainerStyle={ui.screen}>
      <Stack.Screen options={{ title: "Cancel booking" }} />
      {booking.venue.is_synthetic ? <MockBadge text="Synthetic demo booking - mock refund, no real money" /> : null}
      <Text style={ui.heading}>{booking.venue.name}</Text>
      <Text style={ui.body}>
        {formatIstDateTime(booking.start_at)} - {formatIstTime(booking.end_at)} IST · {booking.table.label} · {booking.public_ref}
      </Text>
      <Text style={ui.small}>Policy you accepted: {cancellationPolicySummary(booking.policy_snapshot)}</Text>
      <Card>
        <Text style={ui.heading}>If you cancel now</Text>
        <Text style={ui.body}>You paid {formatInrPaise(terms.captured_paise)}</Text>
        <Text style={ui.price} testID="cancel-refund">Refund {formatInrPaise(terms.refund_paise)}</Text>
        {terms.retained_paise > 0 ? <Text style={ui.body}>Not refunded {formatInrPaise(terms.retained_paise)}</Text> : null}
        {terms.window === "EARLY" && terms.terms_change_at ? (
          <Text style={ui.small}>This refund applies if you cancel before {formatIstDateTime(terms.terms_change_at)} IST.</Text>
        ) : null}
        <Text style={ui.small}>Refunds go back to the original payment method and show as in progress until the payment provider confirms them.</Text>
      </Card>
      {terms.window === "LATE" && terms.refund_paise === 0 ? (
        <Notice tone="warning">The cancellation deadline has passed, so cancelling now gives no refund. The table will be released for others.</Notice>
      ) : null}
      <Text style={ui.body}>Reason (optional)</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {CUSTOMER_CANCEL_REASONS.map((code) => (
          <Chip key={code} label={CUSTOMER_CANCEL_REASON_LABEL[code]} selected={reason === code} onPress={() => chooseReason(code)} testID={`reason-${code}`} />
        ))}
      </View>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {blocked ? (
        <Button label="Back to booking" onPress={toBooking} />
      ) : (
        <Button
          label={terms.refund_paise > 0 ? `Cancel and refund ${formatInrPaise(terms.refund_paise)}` : "Cancel without refund"}
          onPress={() => void confirm()}
          busy={busy}
          testID="confirm-cancel"
        />
      )}
      <Button label="Keep booking" variant="secondary" onPress={toBooking} disabled={busy} testID="keep-booking" />
    </ScrollView>
  );
}
