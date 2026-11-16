// C08 native: owner-only booking with arrival QR and PIN (confirmed only), time, receipt and the accepted rules.
// Cancellation (C10) is offered while CONFIRMED and before the start; the server decides the refund.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, ScrollView, Text } from "react-native";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ApiError } from "@simply-sit/api-client";
import {
  cancellationNotice, cancellationPolicySummary, refundReasonText, refundStatusText, type BookingDetail
} from "@simply-sit/contracts";
import { colors } from "@simply-sit/design-tokens";
import { QrCode } from "../../components/QrCode";
import { Button, Card, MockBadge, Notice, ui } from "../../components/ui";
import { api } from "../../lib/api";
import { FOOD_RULE_LABEL, formatInrPaise, formatIstDateTime, formatIstTime } from "../../lib/format";

const STATUS: Record<string, string> = {
  CONFIRMED: "Confirmed", CHECKED_IN: "Checked in", COMPLETED: "Completed", CANCELLED: "Cancelled", EXPIRED: "Hold ended",
  NO_SHOW: "Missed (no-show)", HOLD: "Held", PENDING_PAYMENT: "Payment in progress"
};

export default function BookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [b, setB] = useState<BookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    try {
      setB(await api.getBooking(String(id)));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "NOT_FOUND" ? "We could not find that booking." : e instanceof Error ? e.message : "Could not load.");
    }
  }, [id]);
  // Reload on focus too, so coming back from the cancel screen shows the cancellation and refund state.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && void load());
    return () => sub.remove();
  }, [load]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!b) return <ActivityIndicator style={{ marginTop: 48 }} color={colors.brandPrimary} accessibilityLabel="Loading booking" />;
  const policy = b.policy_snapshot;
  const cancellable = b.status === "CONFIRMED" && Date.parse(b.server_now) < Date.parse(b.start_at);
  return (
    <ScrollView contentContainerStyle={ui.screen}>
      <Stack.Screen options={{ title: b.venue.name }} />
      {b.venue.is_synthetic ? <MockBadge text="Synthetic demo booking - mock payment" /> : null}
      <Text style={ui.title} testID="booking-status">
        {STATUS[b.status] ?? b.status}
      </Text>
      <Text style={ui.body}>
        {formatIstDateTime(b.start_at)} - {formatIstTime(b.end_at)} IST · {b.table.label} · {b.party_size} {b.party_size === 1 ? "person" : "people"}
      </Text>
      <Text style={ui.body}>
        Reference <Text style={{ fontWeight: "700" }} testID="booking-ref">{b.public_ref}</Text>
      </Text>
      {b.arrival && b.status === "CONFIRMED" ? (
        <Card style={{ alignItems: "center" }}>
          <Text style={ui.heading}>Check in at the venue</Text>
          <QrCode value={b.arrival.qr_token} size={240} label="Check-in QR code for this booking" />
          <Text style={ui.body}>
            Or say your reference and PIN: <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: 4 }} testID="arrival-pin">{b.arrival.pin}</Text>
          </Text>
          <Text style={ui.small}>Check-in opens 15 minutes before the start and closes {policy.grace_minutes} minutes after it. Keep this code private.</Text>
        </Card>
      ) : null}
      {b.status === "CHECKED_IN" ? <Notice tone="success">You are checked in. Enjoy your time.</Notice> : null}
      {b.status === "CHECKED_IN" && Date.parse(b.server_now) < Date.parse(b.end_at) ? (
        <Button label="Need more time?" variant="secondary" testID="extend-booking"
          onPress={() => router.push({ pathname: "/extend/[bookingId]", params: { bookingId: b.booking_id } })} />
      ) : null}
      {b.status === "CANCELLED" && b.confirmed_at ? <Notice>{cancellationNotice(b.cancel_reason)}</Notice> : null}
      {b.status === "COMPLETED" ? (
        <Button label={b.review ? "Your review" : "Rate your visit"} variant="secondary" testID="review-booking"
          onPress={() => router.push({ pathname: "/review/[bookingId]", params: { bookingId: b.booking_id } })} />
      ) : null}
      {b.refunds.map((r) => (
        <Notice key={r.refund_id} tone="warning">
          {`Refund ${formatInrPaise(r.amount_paise)} (${refundReasonText(r.reason_code)}): ${refundStatusText(r.status)}`}
        </Notice>
      ))}
      <Card>
        <Text style={ui.heading}>Receipt</Text>
        <Text style={ui.body}>Table time: {formatInrPaise(b.price_snapshot.base_paise)}</Text>
        <Text style={ui.body}>Service fee: {formatInrPaise(b.price_snapshot.service_fee_paise)}</Text>
        <Text style={ui.price}>Total {formatInrPaise(b.total_paise)}</Text>
        {b.extensions_applied.map((x) => (
          <Text key={x.extension_id} style={ui.body} testID="extension-line">
            Extra {x.additional_minutes} minutes: {formatInrPaise(x.amount_paise)}
          </Text>
        ))}
        <Text style={ui.small}>Payment: {b.payment ? `${b.payment.payment_state.toLowerCase()} (mock provider, test mode)` : "none"}</Text>
      </Card>
      <Card>
        <Text style={ui.heading}>The rules you accepted</Text>
        <Text style={ui.body}>Outside food: {FOOD_RULE_LABEL[policy.byo_food]}. {policy.byo_details}</Text>
        <Text style={ui.body}>Outside delivery: {FOOD_RULE_LABEL[policy.outside_delivery]}.</Text>
        <Text style={ui.body}>{policy.house_rules}</Text>
        <Text style={ui.body}>Cancellation: {cancellationPolicySummary(policy)}</Text>
        <Text style={ui.small}>On arrival: {policy.handover_instructions}</Text>
        <Text style={ui.small}>{b.venue.address}</Text>
      </Card>
      {cancellable ? (
        <Button
          label="Cancel booking"
          variant="secondary"
          onPress={() => router.push({ pathname: "/cancel/[bookingId]", params: { bookingId: b.booking_id } })}
          testID="cancel-booking"
        />
      ) : null}
    </ScrollView>
  );
}
