// C08 native booking pass - Figma "Customer · Confirmed booking pass" (94:10372): owner-only booking with arrival QR
// and PIN (confirmed only), time, receipt and the accepted rules. Cancellation (C10) is offered while CONFIRMED and
// before the start; the server decides the refund. Other states (checked in, completed, cancelled, refunds) keep
// their own notices and actions.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useRef, useState, type ComponentRef } from "react";
import { ActivityIndicator, AppState, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ApiError } from "@simply-sit/api-client";
import {
  cancellationNotice, cancellationPolicySummary, refundReasonText, refundStatusText, type BookingDetail
} from "@simply-sit/contracts";
import { colors, radius, spacing } from "@simply-sit/design-tokens";
import { QrCode } from "../../components/QrCode";
import { Screen } from "../../components/shell";
import { Button, Card, DetailRow, Divider, MockBadge, Notice, StatusPill, fonts, tints, ui } from "../../components/ui";
import { api } from "../../lib/api";
import { FOOD_RULE_LABEL, durationLabel, formatInrPaise, formatIstDate, formatIstDateTime, formatIstTime } from "../../lib/format";

const STATUS: Record<string, string> = {
  CONFIRMED: "Confirmed", CHECKED_IN: "Checked in", COMPLETED: "Completed", CANCELLED: "Cancelled", EXPIRED: "Hold ended",
  NO_SHOW: "Missed (no-show)", HOLD: "Held", PENDING_PAYMENT: "Payment in progress"
};

const HEADLINE: Record<string, string> = {
  CONFIRMED: "Your space is reserved", CHECKED_IN: "You are checked in", COMPLETED: "Thanks for sitting with us",
  CANCELLED: "This booking is cancelled", EXPIRED: "This hold has ended", NO_SHOW: "This booking was missed"
};

const PILL: Record<string, { label: string; tone: "success" | "sage" | "warm" | "neutral" | "danger" }> = {
  CONFIRMED: { label: "Confirmed · Payment verified", tone: "success" },
  CHECKED_IN: { label: "Checked in", tone: "success" },
  COMPLETED: { label: "Completed", tone: "sage" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  EXPIRED: { label: "Hold ended", tone: "neutral" },
  NO_SHOW: { label: "Missed (no-show)", tone: "danger" }
};

export default function BookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [b, setB] = useState<BookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const receiptY = useRef(0);

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

  if (error) {
    return (
      <Screen title="Your booking" back nav="bookings">
        <Notice tone="error">{error}</Notice>
      </Screen>
    );
  }
  if (!b) {
    return (
      <Screen title="Your booking" back nav="bookings">
        <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading booking" />
      </Screen>
    );
  }
  const policy = b.policy_snapshot;
  const now = Date.parse(b.server_now);
  const cancellable = b.status === "CONFIRMED" && now < Date.parse(b.start_at);
  const minutes = Math.round((Date.parse(b.end_at) - Date.parse(b.start_at)) / 60_000);
  const checkInOpens = new Date(Date.parse(b.start_at) - 15 * 60_000).toISOString();
  const fullRefundBy = new Date(Date.parse(b.start_at) - policy.cancel_cutoff_minutes * 60_000).toISOString();
  const pill = PILL[b.status];
  const timeRange = `${formatIstTime(b.start_at)}–${formatIstTime(b.end_at)}`;

  return (
    <Screen title="Your booking" subtitle={b.public_ref} back nav="bookings" scrollRef={scrollRef}>
      <View style={{ gap: spacing.sm }}>
        <Text style={ui.display} accessibilityRole="header">{HEADLINE[b.status] ?? STATUS[b.status] ?? b.status}</Text>
        <Text style={ui.muted}>{`See you at ${b.venue.name}${b.venue.name.endsWith(".") ? "" : "."}`}</Text>
        <View style={ui.row}>
          {pill ? <StatusPill tone={pill.tone} label={pill.label} /> : null}
          {/* Kept for tests and screen readers: the plain status word. */}
          <Text style={s.srStatus} testID="booking-status">{STATUS[b.status] ?? b.status}</Text>
        </View>
        <Text style={ui.small}>
          Booking ID · <Text style={s.ref} testID="booking-ref">{b.public_ref}</Text>
        </Text>
        {b.venue.is_synthetic ? <MockBadge text="Synthetic demo booking - mock payment" /> : null}
      </View>

      <Card>
        <View style={{ gap: 2 }}>
          <Text style={ui.cardTitle}>{b.venue.name}</Text>
          <Text style={ui.small}>{b.venue.locality}</Text>
          <Text style={ui.small}>{`${b.table.label} · ${b.party_size} ${b.party_size === 1 ? "guest" : "guests"}`}</Text>
        </View>
        <Divider />
        <DetailRow label={formatIstDate(b.start_at)} value={timeRange} />
        <DetailRow label="Duration · IST" value={durationLabel(minutes)} />
      </Card>

      {b.arrival && b.status === "CONFIRMED" ? (
        <Card title="Your check-in pass">
          <View style={s.qr}>
            <QrCode value={b.arrival.qr_token} size={220} label="Check-in QR code for this booking" />
          </View>
          <Text style={ui.small}>Or share your check-in PIN with staff</Text>
          <Text style={s.pin} testID="arrival-pin" accessibilityLabel={`PIN ${b.arrival.pin.split("").join(" ")}`}>{b.arrival.pin}</Text>
          <Text style={ui.body}>{policy.handover_instructions || "Show this pass at reception. Staff verify your booking before check-in."}</Text>
          <Text style={ui.small}>{`Keep this code private. Check-in closes ${policy.grace_minutes} minutes after the start.`}</Text>
          <Divider />
          <DetailRow label="Check-in opens" value={`${formatIstTime(checkInOpens)} IST`} />
          <DetailRow label="Your reserved time" value={`${timeRange} IST`} />
        </Card>
      ) : null}

      {b.status === "CHECKED_IN" ? <Notice tone="success">You are checked in. Enjoy your time.</Notice> : null}
      {b.status === "CHECKED_IN" && now < Date.parse(b.end_at) ? (
        <Button label="Need more time?" variant="secondary" testID="extend-booking"
          onPress={() => router.push({ pathname: "/extend/[bookingId]", params: { bookingId: b.booking_id } })} />
      ) : null}
      {b.status === "CANCELLED" && b.confirmed_at ? <Notice>{cancellationNotice(b.cancel_reason)}</Notice> : null}
      {b.status === "COMPLETED" ? (
        <Button label={b.review ? "Your review" : "Rate your visit"} variant="secondary" testID="review-booking"
          onPress={() => router.push({ pathname: "/review/[bookingId]", params: { bookingId: b.booking_id } })} />
      ) : null}
      {b.refunds.length > 0 ? <RefundTracker booking={b} /> : null}

      <View style={s.actions}>
        <View style={{ flex: 1 }}>
          <Button label="Directions" variant="secondary"
            onPress={() => void Linking.openURL(`https://www.openstreetmap.org/?mlat=${b.venue.lat}&mlon=${b.venue.lng}#map=17/${b.venue.lat}/${b.venue.lng}`)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Receipt" variant="secondary" onPress={() => scrollRef.current?.scrollTo({ y: Math.max(0, receiptY.current), animated: true })} />
        </View>
      </View>

      {b.status === "CONFIRMED" ? (
        <Card title="Cancellation & refunds">
          <Text style={ui.body}>
            {now < Date.parse(fullRefundBy)
              ? `Full-refund deadline: ${formatIstDateTime(fullRefundBy)} IST.`
              : `Full-refund deadline: ${formatIstDateTime(fullRefundBy)} IST. That deadline has passed.`}
          </Text>
          <Text style={ui.small}>{cancellationPolicySummary(policy)}</Text>
          {cancellable ? (
            <Button label="Manage booking" variant="secondary" testID="cancel-booking"
              onPress={() => router.push({ pathname: "/cancel/[bookingId]", params: { bookingId: b.booking_id } })} />
          ) : null}
        </Card>
      ) : null}

      <Notice title="Make yourself at home, thoughtfully">
        <Text style={ui.noticeText}>
          {[
            policy.house_rules,
            `Outside food: ${FOOD_RULE_LABEL[policy.byo_food]}. ${policy.byo_details}`.trim(),
            `Delivery: ${FOOD_RULE_LABEL[policy.outside_delivery]}.`,
            `Leave ${b.table.label} by ${formatIstTime(b.end_at)} for its ${policy.buffer_minutes}-minute cleaning.`
          ].filter(Boolean).join(" ")}
        </Text>
      </Notice>

      <View onLayout={(e) => { receiptY.current = e.nativeEvent.layout.y; }}>
        <Card title="Receipt">
          <DetailRow label="Table time" value={formatInrPaise(b.price_snapshot.base_paise)} />
          <DetailRow label="Platform fee" value={formatInrPaise(b.price_snapshot.service_fee_paise)} />
          {b.extensions_applied.map((x) => (
            <View key={x.extension_id} testID="extension-line">
              <DetailRow label={`Extra ${x.additional_minutes} minutes`} value={formatInrPaise(x.amount_paise)} />
            </View>
          ))}
          <Divider />
          <DetailRow label="Amount paid" value={formatInrPaise(b.total_paise)} strong />
          <Text style={ui.small}>{`Payment: ${b.payment ? `${b.payment.payment_state.toLowerCase()} (mock provider, test mode)` : "none"}`}</Text>
          <Text style={ui.small}>{b.venue.address}</Text>
        </Card>
      </View>

      <Button label="View my bookings" onPress={() => router.navigate("/bookings")} />
    </Screen>
  );
}

const s = StyleSheet.create({
  srStatus: { position: "absolute", width: 1, height: 1, opacity: 0 },
  ref: { fontFamily: fonts.semibold, color: colors.textPrimary },
  qr: { alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.card },
  pin: { fontFamily: fonts.semibold, fontSize: 30, letterSpacing: 8, color: colors.textPrimary, fontVariant: ["tabular-nums"] },
  actions: { flexDirection: "row", gap: spacing.md },
  step: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  stepIcon: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" }
});

// Figma "Customer · Cancellation refund and help" (94:10690), on the booking itself: what is coming back and where the
// refund stands. Each refund row is the server's state; "credited" is shown only once the provider has processed it.
function RefundStep({ done, failed, title, detail }: { done: boolean; failed?: boolean; title: string; detail: string }) {
  return (
    <View style={s.step}>
      <View style={[s.stepIcon, { backgroundColor: done ? colors.statusSuccessSurface : failed ? tints.errorSurface : tints.warmSurface }]}>
        <Ionicons name={done ? "checkmark" : failed ? "alert" : "time-outline"} size={14}
          color={done ? colors.statusSuccess : failed ? tints.errorText : tints.warmText} accessible={false} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={ui.label}>{title}</Text>
        <Text style={ui.small}>{detail}</Text>
      </View>
    </View>
  );
}

function RefundTracker({ booking: b }: { booking: BookingDetail }) {
  const refunded = b.refunds.reduce((sum, r) => sum + r.amount_paise, 0);
  const latest = b.refunds[b.refunds.length - 1]!;
  const processed = latest.status === "PROCESSED";
  const failed = latest.status === "FAILED";
  return (
    <>
      <Card title="Your refund" testID="refund-tracker">
        <DetailRow label="Original payment" value={formatInrPaise(b.total_paise)} />
        {b.refunds.map((r) => (
          <DetailRow key={r.refund_id} label={`Refund · ${refundReasonText(r.reason_code)}`} value={formatInrPaise(r.amount_paise)} />
        ))}
        {b.total_paise - refunded > 0 ? <DetailRow label="Not refunded" value={formatInrPaise(b.total_paise - refunded)} /> : null}
        <Divider />
        <DetailRow label={processed ? "Refunded" : "Refund being processed"} value={formatInrPaise(refunded)} strong />
        <StatusPill tone={processed ? "success" : failed ? "danger" : "warm"}
          label={processed ? "Refunded · Credited by the provider" : failed ? "Refund delayed · Still owed to you" : "Refund pending · Not yet credited"} />
        <Text style={ui.small}>{`Refund ${refundStatusText(latest.status)}.`}</Text>
      </Card>
      <Card title="Follow your refund">
        {b.cancelled_at ? <RefundStep done title="Cancellation accepted" detail={`${formatIstDateTime(b.cancelled_at)} IST · table released`} /> : null}
        <RefundStep done title="Refund request created" detail={`${formatIstDateTime(latest.created_at)} IST · ${formatInrPaise(latest.amount_paise)}`} />
        <RefundStep done={processed} failed={failed} title="Payment provider processing"
          detail={processed ? "Done" : failed ? "The provider could not complete it yet. It is flagged for follow-up." : "Usually a few business days."} />
        <RefundStep done={processed} title="Credit to your original payment method"
          detail={processed ? "Credited" : "Awaiting provider confirmation"} />
      </Card>
      <Notice title="Refund taking longer than expected?">
        <Text style={ui.noticeText}>Contact support with your booking ID. Never share a UPI PIN or one-time code with anyone.</Text>
        <Button label={`Contact support · ${b.public_ref}`} variant="secondary" testID="refund-support"
          onPress={() => router.push({ pathname: "/support/new", params: { bookingId: b.booking_id } })} />
      </Notice>
    </>
  );
}
