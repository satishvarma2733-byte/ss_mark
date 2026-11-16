// C11 native: more time on a checked-in booking. Deadlines are the server's, counted against the server clock from the
// last response; "Approved" does not reserve the time - the hold step re-checks it. The end moves only after a verified
// payment. Payment uses the same provider page and return path as checkout.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { ApiError } from "@simply-sit/api-client";
import type { BookingDetail, Extension } from "@simply-sit/contracts";
import { colors } from "@simply-sit/design-tokens";
import { Button, Card, Chip, MockBadge, Notice, ui } from "../../components/ui";
import { SALE_NOTICE } from "../../lib/sales-state";
import { useSalesState } from "../../lib/service-status";
import { api } from "../../lib/api";
import { formatInrPaise, formatIstTime } from "../../lib/format";
import { rememberPendingPayment } from "../../lib/pending-payment";
import { checkoutReturnTarget, newIdempotencyKey } from "../../lib/session";

const OPEN = new Set(["REQUESTED", "APPROVED", "HELD", "PENDING_PAYMENT"]);
const left = (deadline: string | null, now: number) => (deadline ? Math.max(0, Math.floor((Date.parse(deadline) - now) / 1000)) : 0);
const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export default function ExtendScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [minutes, setMinutes] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "warning" | "info"; text: string } | null>(null);
  const [acceptedPrice, setAcceptedPrice] = useState<number | null>(null);
  const sales = useSalesState();
  // One key per user action, kept across a retry after a lost response.
  const keys = useRef({ request: newIdempotencyKey(), hold: newIdempotencyKey() });

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const b = await api.getBooking(String(bookingId));
      setBooking(b);
      setOffset(Date.parse(b.server_now) - Date.now());
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not load the booking." });
    }
  }, [bookingId]);

  useEffect(() => {
    void refresh();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => void refresh(), 4000);
    const sub = AppState.addEventListener("change", (state) => state === "active" && void refresh());
    return () => {
      clearInterval(tick);
      clearInterval(poll);
      sub.remove();
    };
  }, [refresh]);

  if (!booking) {
    return message ? <Notice tone="error">{message.text}</Notice>
      : <ActivityIndicator style={{ marginTop: 48 }} color={colors.brandPrimary} accessibilityLabel="Loading booking" />;
  }
  const increment = Number(booking.policy_snapshot.increment_minutes) || 30;
  const maximum = Number(booking.policy_snapshot.maximum_minutes) || 240;
  const step = increment >= 15 ? increment : Math.ceil(15 / increment) * increment;
  const used = Math.round((Date.parse(booking.end_at) - Date.parse(booking.start_at)) / 60_000);
  const choices: number[] = [];
  for (let m = step; used + m <= maximum && choices.length < 4; m += step) choices.push(m);
  const chosen = minutes ?? choices[0] ?? step;
  const serverNow = now + offset;
  const ext: Extension | null = booking.extension ?? null;
  const open = !!ext && OPEN.has(ext.status);
  const eligible = booking.status === "CHECKED_IN" && serverNow < Date.parse(booking.end_at);

  async function request() {
    if (!api || !booking) return;
    setBusy("request");
    setMessage(null);
    try {
      await api.requestExtension(booking.booking_id, chosen, booking.version, keys.current.request);
      keys.current.request = newIdempotencyKey();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "NETWORK")) keys.current.request = newIdempotencyKey();
      setMessage({ tone: "error", text: e instanceof ApiError && e.code === "OUTSIDE_HOURS" ? "The venue closes before that. Choose less time."
        : e instanceof Error ? e.message : "Could not send the request." });
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  async function pay(current: Extension) {
    if (!api) return;
    let order = await api.startExtensionCheckout(current.extension_id, current.version, checkoutReturnTarget());
    for (let i = 0; !order.checkout && i < 10; i += 1) {
      setMessage({ tone: "info", text: "Setting up the secure payment page..." });
      await new Promise((r) => setTimeout(r, 2000));
      order = await api.getPaymentOrder(order.payment_order_id, checkoutReturnTarget());
    }
    if (!order.checkout) {
      setMessage({ tone: "error", text: "The payment provider is not responding. Try Pay again while the time is held." });
      return;
    }
    setMessage(null);
    await rememberPendingPayment(order.payment_order_id);
    await WebBrowser.openBrowserAsync(order.checkout.checkout_url, { showTitle: true, enableBarCollapsing: true });
  }

  async function holdAndPay() {
    if (!api || !ext) return;
    setBusy("pay");
    setMessage(null);
    try {
      const held = await api.holdExtension(ext.extension_id, acceptedPrice ?? ext.amount_paise, ext.version, keys.current.hold);
      await pay(held);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "NETWORK")) keys.current.hold = newIdempotencyKey();
      if (e instanceof ApiError && e.code === "QUOTE_CHANGED" && typeof e.details.amount_paise === "number") {
        setAcceptedPrice(e.details.amount_paise);
        setMessage({ tone: "warning", text: `The price is now ${formatInrPaise(e.details.amount_paise)}. Confirm again to continue.` });
      } else if (e instanceof ApiError && e.code === "SLOT_UNAVAILABLE") {
        setMessage({ tone: "error", text: "Someone has booked this table right after you, so it cannot be extended. Your booking is unchanged." });
      } else setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not continue." });
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  async function payHeld() {
    if (!ext) return;
    setBusy("pay");
    try {
      await pay(ext);
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not start the payment." });
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  async function withdraw() {
    if (!api || !ext) return;
    setBusy("cancel");
    try {
      await api.cancelExtension(ext.extension_id);
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not withdraw." });
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  return (
    <ScrollView contentContainerStyle={ui.screen}>
      <Stack.Screen options={{ title: "More time" }} />
      {booking.venue.is_synthetic ? <MockBadge text="Synthetic demo booking - mock payment" /> : null}
      <Text style={ui.title} testID="extend-end">Ends at {formatIstTime(booking.end_at)} IST</Text>
      <Text style={ui.small}>{booking.venue.name} · {booking.table.label}</Text>

      {ext?.status === "APPLIED" && !open ? <Notice tone="success">{`Extended by ${ext.additional_minutes} minutes. Payment verified.`}</Notice> : null}
      {ext?.status === "REQUESTED" ? (
        <Card>
          <Text style={ui.body} testID="ext-requested">
            You asked for {ext.additional_minutes} more minutes ({formatInrPaise(ext.amount_paise)}). The venue answers within{" "}
            {mmss(left(ext.request_expires_at, serverNow))}.
          </Text>
          <Text style={ui.small}>Nothing is reserved yet. Your booking still ends at {formatIstTime(ext.original_end_at)} IST.</Text>
        </Card>
      ) : null}
      {ext?.status === "APPROVED" ? (
        <Card>
          <Text style={[ui.body, { color: colors.statusSuccess }]} testID="ext-approved">Approved - confirm availability and pay.</Text>
          <Text style={ui.body}>
            {ext.additional_minutes} more minutes until {formatIstTime(ext.requested_end_at)} IST for {formatInrPaise(acceptedPrice ?? ext.amount_paise)}.
            Confirm within {mmss(left(ext.approval_expires_at, serverNow))}.
          </Text>
          <Button label={`Confirm and pay ${formatInrPaise(acceptedPrice ?? ext.amount_paise)}`} onPress={() => void holdAndPay()} busy={busy === "pay"}
            disabled={busy !== null} testID="ext-pay" />
        </Card>
      ) : null}
      {ext && (ext.status === "HELD" || ext.status === "PENDING_PAYMENT") ? (
        <Card>
          <Text style={ui.body}>The extra time is held for {mmss(left(ext.hold_expires_at, serverNow))}.</Text>
          <Button label={`Pay ${formatInrPaise(ext.amount_paise)}`} onPress={() => void payHeld()} busy={busy === "pay"} disabled={busy !== null} testID="ext-pay-held" />
        </Card>
      ) : null}
      {ext?.status === "DECLINED" ? <Notice tone="warning">{`The venue could not extend this time${ext.decline_reason ? `: ${ext.decline_reason}` : "."}`}</Notice> : null}

      {open ? (
        <Button label="Withdraw request" variant="secondary" onPress={() => void withdraw()} disabled={busy !== null} />
      ) : eligible && choices.length > 0 && sales && sales.extensions !== "open" ? (
        <View testID="extensions-paused">
          <Notice tone="warning">{SALE_NOTICE[sales.extensions].extensions}</Notice>
        </View>
      ) : eligible && choices.length > 0 ? (
        <Card>
          <Text style={ui.body}>How much more time?</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {choices.map((m) => (
              <Chip key={m} label={`${m} min`} selected={chosen === m} onPress={() => setMinutes(m)} testID={`ext-${m}`} />
            ))}
          </View>
          <Button label="Ask the venue" onPress={() => void request()} busy={busy === "request"} disabled={busy !== null} testID="ext-request" />
        </Card>
      ) : (
        <Notice>
          {booking.status !== "CHECKED_IN" ? "More time can be requested once you are checked in."
            : choices.length === 0 ? "This booking is already at the longest length allowed." : "This booking has ended."}
        </Notice>
      )}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </ScrollView>
  );
}
