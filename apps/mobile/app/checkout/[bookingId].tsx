// C06 native checkout - Figma "Customer · Checkout and payment" (94:10244). The countdown is anchored to the server
// clock; the database decides expiry. Pay persists the expected payment on the server, then opens the provider's page
// in a browser tab, where the customer chooses UPI, card or net banking (this app never collects payment details).
// The provider returns through the simplysit-dev:// deep link to /payment-return, which also works after the app was
// killed while paying.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { ApiError } from "@simply-sit/api-client";
import type { BookingDetail } from "@simply-sit/contracts";
import { colors, spacing } from "@simply-sit/design-tokens";
import { Screen } from "../../components/shell";
import { Button, Card, DetailRow, Divider, MockBadge, Notice, StatusPill, ui } from "../../components/ui";
import { api } from "../../lib/api";
import { FOOD_RULE_LABEL, durationLabel, formatInrPaise, formatIstDate, formatIstDateTime, formatIstTime } from "../../lib/format";
import { rememberPendingPayment } from "../../lib/pending-payment";
import { checkoutReturnTarget, newIdempotencyKey } from "../../lib/session";

const percent = (bps: number) => `${Math.round(bps / 100)}%`;

export default function CheckoutScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<"pay" | "cancel" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const cancelKey = useMemo(() => newIdempotencyKey(), []);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const b = await api.getBooking(String(bookingId));
      setBooking(b);
      setOffset(Date.parse(b.server_now) - Date.now());
      if (["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(b.status)) router.replace({ pathname: "/booking/[id]", params: { id: b.booking_id } });
    } catch (error) {
      setMessage(error instanceof ApiError && error.code === "NETWORK" ? error.message : "We could not load this booking.");
    }
  }, [bookingId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const sub = AppState.addEventListener("change", (s) => s === "active" && void refresh());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [refresh]);

  if (!booking) {
    return (
      <Screen title="Review & pay" subtitle="Step 2 of 3" back nav="bookings">
        {message ? <Notice tone="error">{message}</Notice> : <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading hold" />}
      </Screen>
    );
  }
  const remaining = booking.hold_expires_at ? Math.max(0, Math.floor((Date.parse(booking.hold_expires_at) - (now + offset)) / 1000)) : 0;
  const live = (booking.status === "HOLD" || booking.status === "PENDING_PAYMENT") && remaining > 0;
  const inProgress = booking.payment && ["PENDING", "AUTHORIZED", "UNKNOWN"].includes(booking.payment.payment_state);
  const price = booking.price_snapshot;
  const policy = booking.policy_snapshot;
  const minutes = Math.round((Date.parse(booking.end_at) - Date.parse(booking.start_at)) / 60_000);
  const clock = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  const cutoff = new Date(Date.parse(booking.start_at) - policy.cancel_cutoff_minutes * 60_000).toISOString();

  async function pay() {
    if (!api || !booking) return;
    setBusy("pay");
    setMessage(null);
    try {
      let order = await api.startCheckout(booking.booking_id, booking.version, checkoutReturnTarget());
      for (let i = 0; !order.checkout && order.booking.hold_active && i < 10; i += 1) {
        setMessage("Setting up the secure payment page...");
        await new Promise((r) => setTimeout(r, 2000));
        order = await api.getPaymentOrder(order.payment_order_id, checkoutReturnTarget());
      }
      if (!order.checkout) {
        setMessage("The payment provider is not responding. Your table is still held; try Pay again in a moment.");
        return;
      }
      setMessage(null);
      // Opens the provider page; the provider's redirect to our scheme brings the app back to /payment-return. If that
      // redirect is lost (app killed meanwhile), the remembered order lets the next launch resume there.
      await rememberPendingPayment(order.payment_order_id);
      await WebBrowser.openBrowserAsync(order.checkout.checkout_url, { showTitle: true, enableBarCollapsing: true });
    } catch (error) {
      if (error instanceof ApiError && (error.code === "HOLD_EXPIRED" || error.code === "STALE_VERSION")) setMessage(error.message);
      else setMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  async function release() {
    if (!api || !booking) return;
    setBusy("cancel");
    try {
      await api.cancelHold(booking.booking_id, booking.version, cancelKey);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not release the table.");
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  return (
    <Screen title="Review & pay" subtitle={live ? "Step 2 of 3 · Not yet confirmed" : "Step 2 of 3 · Hold ended"} back nav="bookings">
      {live ? (
        <Notice tone="warning">
          <Text style={[ui.heading, remaining < 60 && { color: colors.statusWarning }]} accessibilityRole="timer" testID="hold-countdown">
            {`Table held for ${clock}`}
          </Text>
          <Text style={ui.noticeText}>Complete payment before the hold expires. If it expires, availability is checked again before you can try.</Text>
        </Notice>
      ) : (
        <Notice tone="warning" title={booking.status === "CANCELLED" ? "Table released" : "Hold ended"}>
          <Text style={ui.noticeText} testID="hold-ended">
            {booking.status === "CANCELLED" ? "You released this table. Nothing was charged for it." : "This hold has ended, so the table is no longer reserved for you."}
          </Text>
          {booking.refunds.length > 0 ? <Text style={ui.noticeText}>A payment arrived after the hold ended. A full refund is pending.</Text> : null}
          <Button label="Choose a time again" variant="secondary" onPress={() => router.replace({ pathname: "/venue/[id]", params: { id: booking.venue.id } })} />
        </Notice>
      )}

      <Card>
        <View style={{ gap: 2 }}>
          <Text style={ui.cardTitle}>{booking.venue.name}</Text>
          <Text style={ui.small}>{booking.venue.locality}</Text>
          <Text style={ui.small}>{`${booking.table.label} · ${booking.party_size} ${booking.party_size === 1 ? "guest" : "guests"}`}</Text>
        </View>
        <Divider />
        <DetailRow label={formatIstDate(booking.start_at)} value={`${formatIstTime(booking.start_at)}–${formatIstTime(booking.end_at)}`} />
        <DetailRow label="Duration · IST" value={durationLabel(minutes)} />
        <DetailRow label="Reference" value={booking.public_ref} />
        {live ? <StatusPill tone="warm" label="On hold · Payment required" /> : null}
      </Card>

      <Card title="No surprises at checkout">
        {price.synthetic ? <MockBadge text="Sandbox pricing - no real charge" /> : null}
        <DetailRow label={`Table · ${formatInrPaise(price.hourly_paise)} × ${durationLabel(price.duration_minutes)}`} value={formatInrPaise(price.base_paise)} />
        <DetailRow label="Platform fee" value={formatInrPaise(price.service_fee_paise)} />
        {price.discount_paise > 0 ? <DetailRow label="Discount" value={`-${formatInrPaise(price.discount_paise)}`} /> : null}
        <DetailRow label="Taxes" value="Not configured" />
        <Divider />
        <DetailRow label="Total to pay" value={formatInrPaise(booking.total_paise)} strong testID="checkout-total" />
        <Text style={ui.small}>Food is optional and paid separately at the venue.</Text>
      </Card>

      <Card title="How you will pay">
        <View style={s.payRow}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.brandPrimary} accessible={false} />
          <Text style={[ui.body, { flex: 1 }]}>Choose UPI, card or net banking on the secure payment page. Simply Sit never sees your payment details.</Text>
        </View>
        <MockBadge text="Mock payment provider - test mode, no real charge" />
      </Card>

      <Card title="Know before you book">
        <Text style={ui.body}>
          {policy.early_refund_bps === 0
            ? "This booking is not refundable."
            : Date.parse(cutoff) > now + offset
              ? `Cancel by ${formatIstDateTime(cutoff)} IST for a ${percent(policy.early_refund_bps)} refund. After that, ${policy.late_refund_bps > 0 ? `${percent(policy.late_refund_bps)} is refunded` : "no refund"}.`
              : `The ${percent(policy.early_refund_bps)} refund window closed at ${formatIstTime(cutoff)} IST. Cancelling now gives ${policy.late_refund_bps > 0 ? `a ${percent(policy.late_refund_bps)} refund` : "no refund"}.`}
        </Text>
        <Text style={ui.small}>
          {`No compulsory food order · Outside food: ${FOOD_RULE_LABEL[policy.byo_food]} · ${policy.buffer_minutes}-minute cleaning after each booking`}
        </Text>
      </Card>

      {live ? (
        <View style={{ gap: spacing.md }}>
          {inProgress && booking.payment ? (
            <Notice title="A payment is already in progress">
              <Text style={ui.noticeText}>Check its status before paying again.</Text>
              <Button label="Check payment status" variant="secondary"
                onPress={() => router.push({ pathname: "/payment-return", params: { payment_order_id: booking.payment!.payment_order_id } })} />
            </Notice>
          ) : null}
          {booking.payment?.payment_state === "FAILED" ? (
            <Notice tone="warning" title="The last payment did not go through">
              A failed attempt does not confirm your booking. You can try again while the table is held.
            </Notice>
          ) : null}
          <Button label={`Pay ${formatInrPaise(booking.total_paise)} securely`} onPress={() => void pay()} busy={busy === "pay"} disabled={busy !== null}
            testID="pay" />
          <Button label="Release this table" variant="secondary" onPress={() => void release()} busy={busy === "cancel"} disabled={busy !== null}
            testID="cancel-hold" />
          <Text style={ui.small}>Your booking is confirmed only after payment is verified. Don’t pay again while verification is pending.</Text>
        </View>
      ) : null}
      {message ? <Text style={ui.small} accessibilityLiveRegion="polite">{message}</Text> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  payRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }
});
