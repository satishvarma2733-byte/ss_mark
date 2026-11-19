// C11 native: more time on a checked-in booking - Figma "Customer · Active booking and extension" (94:10575). Deadlines
// are the server's, counted against the server clock from the last response; "Approved" does not reserve the time - the
// hold step re-checks it. The end moves only after a verified payment. Payment uses the same provider page and return
// path as checkout. Before the venue answers, the price is an estimate from the booked hourly rate (shown with ≈), as on
// the web; the venue's request price is the one charged.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { ApiError } from "@simply-sit/api-client";
import type { BookingDetail, Extension } from "@simply-sit/contracts";
import { colors, radius, spacing } from "@simply-sit/design-tokens";
import { Screen } from "../../components/shell";
import { Button, Card, Chip, DetailRow, Divider, MockBadge, Notice, StatusPill, fonts, ui } from "../../components/ui";
import { SALE_NOTICE } from "../../lib/sales-state";
import { useSalesState } from "../../lib/service-status";
import { api } from "../../lib/api";
import { formatInrPaise, formatIstDate, formatIstTime } from "../../lib/format";
import { rememberPendingPayment } from "../../lib/pending-payment";
import { checkoutReturnTarget, newIdempotencyKey } from "../../lib/session";

const OPEN = new Set(["REQUESTED", "APPROVED", "HELD", "PENDING_PAYMENT"]);
const left = (deadline: string | null, now: number) => (deadline ? Math.max(0, Math.floor((Date.parse(deadline) - now) / 1000)) : 0);
const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const plus = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();

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
    return (
      <Screen title="A little more time?" back nav="bookings">
        {message ? <Notice tone="error">{message.text}</Notice>
          : <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading booking" />}
      </Screen>
    );
  }
  const policy = booking.policy_snapshot;
  const increment = Number(policy.increment_minutes) || 30;
  const maximum = Number(policy.maximum_minutes) || 240;
  const step = increment >= 15 ? increment : Math.ceil(15 / increment) * increment;
  const used = Math.round((Date.parse(booking.end_at) - Date.parse(booking.start_at)) / 60_000);
  const choices: number[] = [];
  for (let m = step; used + m <= maximum && choices.length < 4; m += step) choices.push(m);
  const chosen = minutes ?? choices[0] ?? step;
  const serverNow = now + offset;
  const ext: Extension | null = booking.extension ?? null;
  const open = !!ext && OPEN.has(ext.status);
  const eligible = booking.status === "CHECKED_IN" && serverNow < Date.parse(booking.end_at);
  const paused = !!sales && sales.extensions !== "open";
  const minutesLeft = Math.max(0, Math.ceil((Date.parse(booking.end_at) - serverNow) / 60_000));
  const paidSoFar = booking.total_paise + booking.extensions_applied.reduce((sum, x) => sum + x.amount_paise, 0);
  const hourly = booking.price_snapshot.hourly_paise;
  const shownMinutes = open && ext ? ext.additional_minutes : chosen;
  const estimate = Math.round((hourly * shownMinutes) / 60);
  const extra = open && ext ? acceptedPrice ?? ext.amount_paise : estimate;
  const money = (paise: number) => (open ? formatInrPaise(paise) : `≈ ${formatInrPaise(paise)}`);
  const newEnd = open && ext ? ext.requested_end_at : plus(booking.end_at, chosen);
  const endTime = formatIstTime(booking.end_at);
  const showQuote = (eligible && choices.length > 0) || open;

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
    <Screen title="A little more time?" back nav="bookings">
      <Card>
        <StatusPill tone={booking.status === "CHECKED_IN" ? "success" : "neutral"}
          label={booking.status === "CHECKED_IN" ? (eligible ? "Checked in · Active" : "Checked in · Ended") : "Not checked in"} />
        {booking.venue.is_synthetic ? <MockBadge text="Synthetic demo booking - mock payment" /> : null}
        <View style={{ gap: 4 }}>
          <Text style={ui.display} accessibilityRole="header">{booking.venue.name}</Text>
          <Text style={ui.small}>
            {`${booking.table.label} · ${booking.party_size} ${booking.party_size === 1 ? "guest" : "guests"} · ${booking.public_ref}`}
          </Text>
        </View>
        {eligible ? (
          <View style={s.remaining} accessible accessibilityLabel={`${minutesLeft} minutes remaining`}>
            <Text style={s.remainingValue}>{`${minutesLeft} min`}</Text>
            <Text style={ui.small}>{`remaining · current time ${formatIstTime(new Date(serverNow).toISOString())} IST`}</Text>
          </View>
        ) : null}
        <Divider />
        <DetailRow label={formatIstDate(booking.start_at)} value={`${formatIstTime(booking.start_at)}–${endTime}`} />
        <Text style={ui.small} testID="extend-end">{`Ends at ${endTime} IST`}</Text>
        <Text style={ui.small}>Extensions are optional and subject to availability.</Text>
        {ext?.status === "APPLIED" && !open ? (
          <Notice tone="success">{`Extended by ${ext.additional_minutes} minutes. Payment verified.`}</Notice>
        ) : null}
      </Card>

      {eligible && !open && choices.length > 0 && sales && sales.extensions !== "open" ? (
        <View testID="extensions-paused">
          <Notice tone="warning">{SALE_NOTICE[sales.extensions].extensions}</Notice>
        </View>
      ) : null}

      {eligible && !open && choices.length > 0 && !paused ? (
        <View style={{ gap: spacing.md }}>
          <View style={{ gap: 2 }}>
            <Text style={ui.heading} accessibilityRole="header">Stay a little longer</Text>
            <Text style={ui.small}>{`Available after your current slot, up to ${formatIstTime(plus(booking.start_at, maximum))} IST`}</Text>
          </View>
          <View style={s.chips}>
            {choices.map((m) => (
              <Chip key={m} label={`+${m} min`} selected={chosen === m} onPress={() => setMinutes(m)} testID={`ext-${m}`} />
            ))}
          </View>
          <Notice title="Another guest’s booking stays protected">
            <Text style={ui.noticeText}>
              {`The full ${policy.buffer_minutes}-minute cleaning buffer must fit before the next booking on this table. Extensions never move the next stay.`}
            </Text>
          </Notice>
        </View>
      ) : null}

      {showQuote ? (
        <Card title="Your updated time">
          <DetailRow label="Original end" value={`${endTime} IST`} />
          <DetailRow label="Proposed new end" value={`${formatIstTime(newEnd)} IST`} strong />
          <Divider />
          <DetailRow label={`${shownMinutes} minutes · ${formatInrPaise(hourly)}/hour`} value={money(extra)} />
          <Divider />
          <DetailRow label="Extra to pay" value={money(extra)} strong />
          <DetailRow label="Revised booking total" value={money(paidSoFar + extra)} />
          <Text style={ui.small}>
            {`The original ${formatInrPaise(paidSoFar)} is already paid. Only the extra will be charged. `}
            {open ? "Price set by the venue for this request." : "Estimate from your booked rate; the venue confirms the exact price when it answers."}
          </Text>
        </Card>
      ) : null}

      {ext?.status === "REQUESTED" ? (
        <Notice title="Waiting for the venue">
          <Text style={ui.noticeText} testID="ext-requested">
            {`You asked for ${ext.additional_minutes} more minutes. The venue answers within ${mmss(left(ext.request_expires_at, serverNow))}.`}
          </Text>
          <Text style={ui.noticeText}>{`Nothing is reserved yet. Your booking still ends at ${formatIstTime(ext.original_end_at)} IST.`}</Text>
        </Notice>
      ) : null}
      {ext?.status === "APPROVED" ? (
        <View style={{ gap: spacing.sm }}>
          <StatusPill tone="success" label="Approved · Confirm availability and pay" />
          <Text style={ui.body} testID="ext-approved">{`Confirm within ${mmss(left(ext.approval_expires_at, serverNow))}.`}</Text>
          <Button label={busy === "pay" ? "Checking availability..." : `Check availability & pay ${formatInrPaise(acceptedPrice ?? ext.amount_paise)}`}
            onPress={() => void holdAndPay()} busy={busy === "pay"} disabled={busy !== null} testID="ext-pay" />
        </View>
      ) : null}
      {ext && (ext.status === "HELD" || ext.status === "PENDING_PAYMENT") ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={ui.body}>
            {`The extra time is held for ${mmss(left(ext.hold_expires_at, serverNow))}.`}
            {ext.status === "PENDING_PAYMENT" ? " A payment may already be in progress." : ""}
          </Text>
          <Button label={`Pay ${formatInrPaise(ext.amount_paise)}`} onPress={() => void payHeld()} busy={busy === "pay"} disabled={busy !== null}
            testID="ext-pay-held" />
        </View>
      ) : null}
      {ext?.status === "DECLINED" ? (
        <Notice tone="warning">{`The venue could not extend this time${ext.decline_reason ? `: ${ext.decline_reason}` : "."}`}</Notice>
      ) : null}

      {open ? (
        <Button key="withdraw" label="Withdraw request" variant="secondary" onPress={() => void withdraw()} disabled={busy !== null} />
      ) : eligible && choices.length > 0 && !paused ? (
        <Button key="request" label={`Ask the venue for ${chosen} minutes`} onPress={() => void request()} busy={busy === "request"} disabled={busy !== null}
          testID="ext-request" />
      ) : !eligible || choices.length === 0 ? (
        <Notice>
          {booking.status !== "CHECKED_IN" ? "More time can be requested once you are checked in."
            : choices.length === 0 ? "This booking is already at the longest length allowed." : "This booking has ended."}
        </Notice>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {showQuote ? (
        <>
          <Text style={ui.small}>
            {`Your end time stays ${endTime} until availability is rechecked and the extension payment is verified. We never move another guest’s reservation.`}
          </Text>
          <Notice tone="warning" title="If this slot becomes unavailable">
            <Text style={ui.noticeText}>
              We keep your original booking unchanged and won’t confirm an extension. Any debited but unconfirmed payment is tracked for reversal.
            </Text>
          </Notice>
        </>
      ) : null}

      <Card>
        <View style={s.helpRow}>
          <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.brandPrimary} accessible={false} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={ui.label}>Need something during your stay?</Text>
            <Text style={ui.small}>Ask the venue team or contact booking support.</Text>
          </View>
        </View>
        <Button label="Get help with this booking" variant="secondary"
          onPress={() => router.push({ pathname: "/support/new", params: { bookingId: booking.booking_id } })} />
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  remaining: { alignItems: "center", gap: 2, paddingVertical: spacing.base, borderRadius: radius.card, backgroundColor: colors.surfaceCanvas },
  remainingValue: { fontFamily: fonts.semibold, fontSize: 28, lineHeight: 34, color: colors.textPrimary, fontVariant: ["tabular-nums"] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  helpRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }
});
