// C07 native: the provider's redirect (simplysit-dev://payment-return?...) lands here, including on a cold start after
// the app was killed while the customer paid. The query values are hints; the server fetches the payment itself and
// this screen says "confirmed" only when the server's booking is CONFIRMED.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ApiError } from "@simply-sit/api-client";
import type { PaymentOrderStatus } from "@simply-sit/contracts";
import { colors } from "@simply-sit/design-tokens";
import { Screen } from "../components/shell";
import { Button, Card, MockBadge, Notice, tints, ui } from "../components/ui";
import { api } from "../lib/api";
import { formatInrPaise, formatIstTime } from "../lib/format";
import { clearPendingPayment } from "../lib/pending-payment";
import { checkoutReturnTarget, useSession } from "../lib/session";

type Params = { payment_order_id?: string; provider_payment_id?: string; signature?: string; status?: string };

// Extension payment (M4.2): the outcome is the extension's; the end time moves only once it is APPLIED.
function describeExtension(s: PaymentOrderStatus, returned: string | undefined) {
  const b = s.booking;
  const ext = b.extension?.extension_id === s.extension_id ? b.extension : null;
  if (ext?.status === "APPLIED") {
    return { tone: "success" as const, title: "Extension confirmed", body: `Payment verified. Your booking now ends at ${formatIstTime(b.end_at)} IST.`, action: "booking" as const };
  }
  if (ext && ["EXPIRED", "CANCELLED", "DECLINED"].includes(ext.status)) {
    const refund = b.refunds.find((r) => r.status !== "FAILED" && Date.parse(r.created_at) >= Date.parse(ext.request_expires_at) - 5 * 60_000);
    return { tone: "warning" as const, title: "Extension not applied",
      body: `Your booking still ends at ${formatIstTime(b.end_at)} IST.${refund ? ` A payment arrived after the extension hold ended; a full refund of ${formatInrPaise(refund.amount_paise)} is ${refund.status === "PROCESSED" ? "processed (mock provider)" : "pending"}.` : " No payment was taken for it."}`,
      action: "booking" as const };
  }
  if (returned === "failed") return { tone: "error" as const, title: "Payment failed", body: "The payment did not go through. The extra time is still held for a few minutes.", action: "extend" as const };
  if (returned === "cancelled") return { tone: "info" as const, title: "Payment not completed", body: "You left the payment page. The extra time is held until the timer ends.", action: "extend" as const };
  return { tone: "info" as const, title: "Verifying payment...", body: "Checking the payment with the provider.", action: null };
}

function describe(s: PaymentOrderStatus, returned: string | undefined, slow: boolean) {
  if (s.extension_id) return describeExtension(s, returned);
  const b = s.booking;
  const refund = b.refunds.find((r) => r.status !== "FAILED");
  if (["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(b.status)) {
    return { tone: "success" as const, title: "Booking confirmed", body: `Payment verified. Reference ${b.public_ref}.`, action: "booking" as const };
  }
  if (refund) {
    return { tone: "warning" as const, title: refund.status === "PROCESSED" ? "Refund processed" : "Refund pending",
      body: `The hold ended before this payment completed, so it was not booked. A full refund of ${formatInrPaise(refund.amount_paise)} is ${refund.status === "PROCESSED" ? "processed (mock provider)" : "pending"}.`, action: "search" as const };
  }
  if (b.payment?.allocation === "UNDER_REVIEW") {
    return { tone: "warning" as const, title: "Payment under review", body: "The amount did not match this booking, so it was not confirmed. It is held for review and will be refunded if it cannot be used.", action: "bookings" as const };
  }
  if (!b.hold_active) {
    return (b.payment?.open_attempts ?? 0) > 0
      ? { tone: "warning" as const, title: "Hold ended", body: "This hold has ended. A payment is still pending with the provider; if it is taken, it will be refunded in full.", action: "search" as const }
      : { tone: "info" as const, title: "Hold ended", body: "This hold has ended and no payment was taken for it.", action: "search" as const };
  }
  if (b.payment?.payment_state === "FAILED" && returned !== "pending") {
    return { tone: "error" as const, title: "Payment failed", body: "The payment did not go through. Your table is still held for now.", action: "checkout" as const };
  }
  if (returned === "cancelled" && (b.payment?.payment_state ?? "NONE") === "NONE") {
    return { tone: "info" as const, title: "Payment not completed", body: "You left the payment page. Your table is still held until the timer ends.", action: "checkout" as const };
  }
  // Resumed without a provider result (app restarted, tab closed) and the provider has no payment for this order.
  if (returned !== "success" && returned !== "pending" && (b.payment?.payment_state ?? "NONE") === "NONE") {
    return { tone: "info" as const, title: "No payment received yet",
      body: "We have not received a payment for this hold. Your table is still held until the timer ends.", action: "checkout" as const };
  }
  return { tone: "info" as const, title: "Verifying payment...",
    body: slow ? "This is taking longer than usual. Please do not pay again; if a second payment is taken, it is refunded in full." : "Checking the payment with the provider.",
    action: slow ? ("bookings" as const) : null };
}

export default function PaymentReturnScreen() {
  const params = useLocalSearchParams<Params>();
  const { ready, session } = useSession();
  const [state, setState] = useState<PaymentOrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const started = useRef(Date.now());
  const orderId = typeof params.payment_order_id === "string" && /^[0-9a-f-]{36}$/i.test(params.payment_order_id) ? params.payment_order_id : null;

  useEffect(() => {
    if (!api || !orderId || !session) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll(first: boolean) {
      try {
        const elapsed = Date.now() - started.current;
        const result = first
          ? await api!.verifyPayment(orderId!, {
              ...(typeof params.provider_payment_id === "string" && /^[A-Za-z0-9_]{1,120}$/.test(params.provider_payment_id) ? { provider_payment_id: params.provider_payment_id } : {}),
              ...(typeof params.signature === "string" && /^[0-9a-f]{64}$/.test(params.signature) ? { signature: params.signature } : {}),
              ...(typeof params.status === "string" && ["success", "failed", "cancelled", "pending"].includes(params.status) ? { status: params.status } : {})
            })
          : elapsed < 30_000
            ? await api!.verifyPayment(orderId!)
            : await api!.getPaymentOrder(orderId!, checkoutReturnTarget());
        if (stopped) return;
        setState(result);
        setError(null);
        setSlow(Date.now() - started.current > 60_000);
        // A final server state (confirmed, ended, refund) needs no resume on the next launch.
        if (result.next_poll_after_seconds === null) void clearPendingPayment();
        if (result.next_poll_after_seconds !== null && Date.now() - started.current < 10 * 60_000) {
          timer = setTimeout(() => void poll(false), result.next_poll_after_seconds * 1000);
        }
      } catch (e) {
        if (stopped) return;
        setError(e instanceof ApiError && e.code === "NOT_FOUND" ? "We could not find this payment for your account." : e instanceof Error ? e.message : "Something went wrong.");
        if (!(e instanceof ApiError) || e.retryable) timer = setTimeout(() => void poll(false), 5000);
      }
    }
    void poll(true);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [orderId, session, params.provider_payment_id, params.signature, params.status]);

  const shell = (children: ReactNode) => (
    <Screen title="Payment status" subtitle="Step 3 of 3" nav="bookings">
      {children}
    </Screen>
  );
  if (!ready) return shell(<ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading" />);
  if (!orderId) return shell(<Notice tone="error">This payment link is incomplete. Open Bookings to see the current status.</Notice>);
  if (!session) {
    return shell(
      <>
        <Notice title="Sign in to see this payment">
          <Text style={ui.noticeText}>Your payment is safe; signing in shows its status.</Text>
        </Notice>
        <Button label="Sign in on the Account tab" onPress={() => router.push("/account")} />
      </>
    );
  }
  const view = state ? describe(state, typeof params.status === "string" ? params.status : undefined, slow) : null;
  const tone = view ? TONE[view.tone] : null;
  return shell(
    <>
      {!state && !error ? <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Checking payment" /> : null}
      {view && state && tone ? (
        <Card style={s.outcome}>
          <View style={[s.icon, { backgroundColor: tone.bg }]}>
            <Ionicons name={tone.icon} size={30} color={tone.fg} accessible={false} />
          </View>
          <Text style={[ui.title, s.center, { color: tone.fg }]} testID="payment-title" accessibilityLiveRegion="polite">
            {view.title}
          </Text>
          <Text style={[ui.muted, s.center]}>{view.body}</Text>
          {view.action === "booking" ? (
            <Button label="View booking and check-in code" testID="view-booking"
              onPress={() => router.replace({ pathname: "/booking/[id]", params: { id: state.booking.booking_id } })} />
          ) : null}
          {view.action === "checkout" ? (
            <Button label="Back to checkout" onPress={() => router.replace({ pathname: "/checkout/[bookingId]", params: { bookingId: state.booking.booking_id } })} />
          ) : null}
          {view.action === "extend" ? (
            <Button label="Back to extension" onPress={() => router.replace({ pathname: "/extend/[bookingId]", params: { bookingId: state.booking.booking_id } })} />
          ) : null}
          {view.action === "search" ? <Button label="Choose a time again" variant="secondary" onPress={() => router.replace("/")} /> : null}
          {view.action === "bookings" ? <Button label="Your bookings" variant="secondary" onPress={() => router.replace("/bookings")} /> : null}
          <MockBadge text="Mock payment provider - test mode" />
        </Card>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </>
  );
}

const TONE: Record<"success" | "warning" | "error" | "info", { bg: string; fg: string; icon: ComponentProps<typeof Ionicons>["name"] }> = {
  success: { bg: colors.statusSuccessSurface, fg: colors.statusSuccessText, icon: "checkmark-circle-outline" },
  warning: { bg: tints.warmSurface, fg: tints.warmText, icon: "time-outline" },
  error: { bg: tints.errorSurface, fg: tints.errorText, icon: "close-circle-outline" },
  info: { bg: colors.noticeSurface, fg: colors.textPrimary, icon: "information-circle-outline" }
};

const s = StyleSheet.create({
  outcome: { alignItems: "stretch" },
  icon: { alignSelf: "center", width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  center: { textAlign: "center" }
});
