// C06 native checkout. The countdown is anchored to the server clock; the database decides expiry. Pay persists the
// expected payment on the server, then opens the provider's page in a browser tab. The provider returns through the
// simplysit-dev:// deep link to /payment-return, which also works after the app was killed while paying.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, AppState, ScrollView, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { ApiError } from "@simply-sit/api-client";
import type { BookingDetail } from "@simply-sit/contracts";
import { colors } from "@simply-sit/design-tokens";
import { Button, Card, MockBadge, Notice, ui } from "../../components/ui";
import { api } from "../../lib/api";
import { formatInrPaise, formatIstDateTime, formatIstTime } from "../../lib/format";
import { rememberPendingPayment } from "../../lib/pending-payment";
import { checkoutReturnTarget, newIdempotencyKey } from "../../lib/session";

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
      <View style={ui.screen}>
        {message ? <Notice tone="error">{message}</Notice> : <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading hold" />}
      </View>
    );
  }
  const remaining = booking.hold_expires_at ? Math.max(0, Math.floor((Date.parse(booking.hold_expires_at) - (now + offset)) / 1000)) : 0;
  const live = (booking.status === "HOLD" || booking.status === "PENDING_PAYMENT") && remaining > 0;
  const inProgress = booking.payment && ["PENDING", "AUTHORIZED", "UNKNOWN"].includes(booking.payment.payment_state);

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
    <ScrollView contentContainerStyle={ui.screen}>
      <Stack.Screen options={{ title: "Checkout" }} />
      <MockBadge text="Mock payment provider - test mode, no real charge" />
      <Card>
        <Text style={ui.heading}>{booking.venue.name}</Text>
        <Text style={ui.body}>
          {formatIstDateTime(booking.start_at)} - {formatIstTime(booking.end_at)} IST · {booking.table.label}
        </Text>
        <Text style={ui.small}>Reference {booking.public_ref}</Text>
        <Text style={ui.price}>{formatInrPaise(booking.total_paise)}</Text>
      </Card>
      {live ? (
        <>
          <Text style={[ui.heading, remaining < 60 && { color: colors.statusWarning }]} accessibilityRole="timer" testID="hold-countdown">
            Table held for {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
          </Text>
          {inProgress && booking.payment ? (
            <Notice>
              <Text style={ui.body}>A payment is already in progress. Check its status before paying again.</Text>
              <Button label="Check payment status" variant="secondary"
                onPress={() => router.push({ pathname: "/payment-return", params: { payment_order_id: booking.payment!.payment_order_id } })} />
            </Notice>
          ) : null}
          {booking.payment?.payment_state === "FAILED" ? <Notice tone="warning">The last payment attempt failed. You can try again while the table is held.</Notice> : null}
          <Button label={`Pay ${formatInrPaise(booking.total_paise)}`} onPress={() => void pay()} busy={busy === "pay"} disabled={busy !== null} testID="pay" />
          <Button label="Release this table" variant="secondary" onPress={() => void release()} busy={busy === "cancel"} disabled={busy !== null}
            testID="cancel-hold" />
        </>
      ) : (
        <Notice tone="warning">
          <Text style={ui.body} testID="hold-ended">
            {booking.status === "CANCELLED" ? "You released this table. Nothing was charged for it." : "This hold has ended, so the table is no longer reserved for you."}
          </Text>
          {booking.refunds.length > 0 ? <Text style={ui.body}>A payment arrived after the hold ended. A full refund is pending.</Text> : null}
          <Button label="Choose a time again" variant="secondary" onPress={() => router.replace({ pathname: "/venue/[id]", params: { id: booking.venue.id } })} />
        </Notice>
      )}
      {message ? <Text style={ui.small} accessibilityLiveRegion="polite">{message}</Text> : null}
    </ScrollView>
  );
}
