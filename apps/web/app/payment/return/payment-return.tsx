"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheck, CircleX, Clock, Info, LoaderCircle } from "lucide-react";
import type { PaymentOrderStatus } from "@simply-sit/contracts";
import { apiCall } from "../../../lib/client-api";
import { formatInrPaise, formatVenueTime } from "../../../lib/format";
import { ButtonLink, Card } from "../../../components/ui";

type Props = { orderId: string; providerPaymentId?: string | undefined; signature?: string | undefined; status?: string | undefined };
type View = { tone: string; title: string; body: string; link?: { href: string; label: string } };

// Extension payment (M4.2): the outcome is the extension's. The end time moves only once the extension is APPLIED.
function describeExtension(s: PaymentOrderStatus, returned: string | undefined, slow: boolean): View {
  const b = s.booking;
  const ext = b.extension?.extension_id === s.extension_id ? b.extension : null;
  const back = { href: `/bookings/${b.booking_id}`, label: "View booking" };
  const extendPage = { href: `/bookings/${b.booking_id}/extend`, label: "Back to extension" };
  if (ext?.status === "APPLIED") {
    return { tone: "status-success", title: "Extension confirmed", body: `Payment verified. Your booking now ends at ${formatVenueTime(b.end_at)} IST.`, link: back };
  }
  if (ext && ["EXPIRED", "CANCELLED", "DECLINED"].includes(ext.status)) {
    const refund = b.refunds.find((r) => r.status !== "FAILED" && Date.parse(r.created_at) >= Date.parse(ext.request_expires_at) - 5 * 60_000);
    return {
      tone: "status-warning",
      title: "Extension not applied",
      body: `Your booking still ends at ${formatVenueTime(b.end_at)} IST.${refund ? ` A payment arrived after the extension hold ended, so a full refund of ${formatInrPaise(refund.amount_paise)} ${refund.status === "PROCESSED" ? "has been processed (mock provider)" : "is pending with the provider"}.` : " No payment was taken for it."}`,
      link: back
    };
  }
  if (returned === "failed") return { tone: "status-error", title: "Payment failed", body: "The payment did not go through. The extra time is still held for a few minutes.", link: extendPage };
  if (returned === "cancelled") return { tone: "", title: "Payment not completed", body: "You left the payment page. The extra time is held until the timer ends.", link: extendPage };
  return { tone: "", title: "Verifying payment...", body: slow ? "This is taking longer than usual. You can leave this page; your booking shows the result." : "Checking the payment with the provider.", link: back };
}

// Everything shown here derives from the server's booking/payment/refund states, never from the redirect's "status".
function describe(s: PaymentOrderStatus, returned: string | undefined, slow: boolean): View {
  if (s.extension_id) return describeExtension(s, returned, slow);
  const b = s.booking;
  const refund = b.refunds.find((r) => r.status !== "FAILED");
  if (b.status === "CONFIRMED" || b.status === "CHECKED_IN" || b.status === "COMPLETED") {
    return { tone: "status-success", title: "Booking confirmed", body: `Payment verified. Reference ${b.public_ref}.`, link: { href: `/bookings/${b.booking_id}`, label: "View booking and check-in code" } };
  }
  if (refund) {
    return {
      tone: "status-warning",
      title: refund.status === "PROCESSED" ? "Refund processed" : "Refund pending",
      body: `The table hold ended before this payment completed, so it was not booked. A full refund of ${formatInrPaise(refund.amount_paise)} ${refund.status === "PROCESSED" ? "has been processed (mock provider)" : "is pending with the provider"}.`,
      link: { href: `/venues/${b.venue.slug}`, label: "Choose a time again" }
    };
  }
  if (b.payment?.allocation === "UNDER_REVIEW") {
    return { tone: "status-warning", title: "Payment under review", body: "The payment amount did not match this booking, so it was not confirmed. It is held for review and will be refunded if it cannot be used for this booking.", link: { href: "/bookings", label: "Your bookings" } };
  }
  if (!b.hold_active) {
    return (b.payment?.open_attempts ?? 0) > 0
      ? { tone: "status-warning", title: "Hold ended", body: "This hold has ended. A payment is still pending with the provider; if it is taken, it will be refunded in full.", link: { href: `/venues/${b.venue.slug}`, label: "Choose a time again" } }
      : { tone: "", title: "Hold ended", body: "This hold has ended and no payment was taken for it.", link: { href: `/venues/${b.venue.slug}`, label: "Choose a time again" } };
  }
  if (b.payment?.payment_state === "FAILED" && returned !== "pending") {
    return { tone: "status-error", title: "Payment failed", body: "The payment did not go through. Your table is still held for now.", link: { href: `/checkout/${b.booking_id}`, label: "Try paying again" } };
  }
  if (returned === "cancelled" && (b.payment?.payment_state ?? "NONE") === "NONE") {
    return { tone: "", title: "Payment not completed", body: "You left the payment page. Your table is still held until the timer ends.", link: { href: `/checkout/${b.booking_id}`, label: "Back to checkout" } };
  }
  // Opened without a provider result (e.g. from a bookmark) and the provider has no payment for this order.
  if (returned !== "success" && returned !== "pending" && (b.payment?.payment_state ?? "NONE") === "NONE") {
    return { tone: "", title: "No payment received yet", body: "We have not received a payment for this hold. Your table is still held until the timer ends.", link: { href: `/checkout/${b.booking_id}`, label: "Back to checkout" } };
  }
  return {
    tone: "",
    title: "Verifying payment...",
    body: slow
      ? "This is taking longer than usual. We will update your booking as soon as the provider confirms. Please do not pay again; if a second payment is taken, it is refunded in full."
      : "We are checking the payment with the provider. This page updates by itself.",
    ...(slow ? { link: { href: "/bookings", label: "Your bookings" } } : {})
  };
}

export function PaymentReturn({ orderId, providerPaymentId, signature, status }: Props) {
  const [state, setState] = useState<PaymentOrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const started = useRef(Date.now());

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll(first: boolean) {
      const result = first
        ? await apiCall<PaymentOrderStatus>("POST", `/api/v1/payment-orders/${orderId}/verify`, {
            body: {
              ...(providerPaymentId && /^[A-Za-z0-9_]{1,120}$/.test(providerPaymentId) ? { provider_payment_id: providerPaymentId } : {}),
              ...(signature && /^[0-9a-f]{64}$/.test(signature) ? { signature } : {}),
              ...(status && ["success", "failed", "cancelled", "pending"].includes(status) ? { status } : {})
            }
          })
        : Date.now() - started.current < 30_000
          ? await apiCall<PaymentOrderStatus>("POST", `/api/v1/payment-orders/${orderId}/verify`, { body: {} })
          : // After 30 s stop asking the provider from this page; webhooks and the worker's reconciliation take over.
            await apiCall<PaymentOrderStatus>("GET", `/api/v1/payment-orders/${orderId}?client=web`);
      if (stopped) return;
      if (result.ok) {
        setError(null);
        setState(result.data);
        setSlow(Date.now() - started.current > 60_000);
        if (result.data.next_poll_after_seconds !== null && Date.now() - started.current < 10 * 60_000) {
          timer = setTimeout(() => void poll(false), result.data.next_poll_after_seconds * 1000);
        }
      } else {
        setError(result.code === "NOT_FOUND" ? "We could not find this payment for your account." : result.message);
        if (result.retryable) timer = setTimeout(() => void poll(false), 5000);
      }
    }
    void poll(true);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [orderId, providerPaymentId, signature, status]);

  if (!state && !error) return <div className="skeleton" aria-label="Checking payment" />;
  const view = state ? describe(state, status, slow) : null;
  // One layout for every outcome: an icon that names the state (not colour alone), the title, what happened, and
  // the next step. The copy above is unchanged; it always derives from the server's booking and payment states.
  const kind = !view ? "error" : view.tone === "status-success" ? "success" : view.tone === "status-error" ? "error" : view.tone === "status-warning" ? "warning" : view.title.startsWith("Verifying") ? "pending" : "neutral";
  const Icon = kind === "success" ? CircleCheck : kind === "error" ? CircleX : kind === "warning" ? Clock : kind === "pending" ? LoaderCircle : Info;
  return (
    <Card className={`outcome outcome-${kind}`} aria-live="polite" data-testid="payment-status">
      <span className="outcome-icon" aria-hidden="true">
        <Icon size={30} />
      </span>
      {view ? (
        <>
          <h2 className={view.tone} data-testid="payment-title">
            {view.title}
          </h2>
          <p className="outcome-body">{view.body}</p>
          <div className="outcome-actions">
            {view.link ? <ButtonLink href={view.link.href}>{view.link.label}</ButtonLink> : null}
            {view.link?.href !== "/bookings" && kind !== "success" ? (
              <ButtonLink variant="secondary" href="/bookings">
                Your bookings
              </ButtonLink>
            ) : null}
          </div>
        </>
      ) : null}
      {error ? (
        <p className="status-error" role="alert">
          {error}
        </p>
      ) : null}
      {error && !view ? (
        <div className="outcome-actions">
          <ButtonLink variant="secondary" href="/bookings">
            Your bookings
          </ButtonLink>
        </div>
      ) : null}
      <span className="badge">Mock payment provider - test mode</span>
    </Card>
  );
}
