// Customer booking and payment projections for the API and pages. Server-only.
import { cancelPreviewSchema, type BookingDetail, type CancelPreview, type PaymentOrderStatus } from "@simply-sit/contracts";
import { asUser, cancelPreview, customerBooking, customerPaymentOrder, type PaymentOrderRow, type VerifiedClaims } from "@simply-sit/db";
import { arrivalCodes } from "@simply-sit/domain";
import { checkoutConfig } from "@simply-sit/payments";
import type { CheckoutReturnTarget } from "@simply-sit/providers";
import { customerPrice } from "./price";
import { getPaymentServices } from "./server-env";

// The owner's booking. Arrival codes are derived for CONFIRMED/CHECKED_IN only and are never logged or put in a URL.
export async function loadBookingDetail(claims: VerifiedClaims, bookingId: string): Promise<BookingDetail> {
  const services = getPaymentServices();
  const row = await asUser(services.sql, claims, (tx) => customerBooking(tx, bookingId));
  const arrival =
    row.status === "CONFIRMED" || row.status === "CHECKED_IN"
      ? (({ qrToken, pin }) => ({ qr_token: qrToken, pin }))(arrivalCodes(services.arrivalSecret, bookingId))
      : null;
  const detail = row as unknown as Omit<BookingDetail, "arrival">;
  return { ...detail, price_snapshot: customerPrice(detail.price_snapshot), arrival };
}

// C10: what cancelling now would refund, at the database clock. No mutation.
export async function loadCancelPreview(claims: VerifiedClaims, bookingId: string): Promise<CancelPreview> {
  const row = await asUser(getPaymentServices().sql, claims, (tx) => cancelPreview(tx, bookingId));
  return cancelPreviewSchema.parse(row);
}

const TERMINAL = new Set(["CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "EXPIRED", "NO_SHOW"]);

// Payment return / status screen: never says "paid" unless the booking itself is CONFIRMED.
export function toPaymentOrderStatus(
  order: PaymentOrderRow & { booking: Record<string, unknown> },
  client: CheckoutReturnTarget
): PaymentOrderStatus {
  const booking = order.booking as PaymentOrderStatus["booking"];
  const hasRefund = booking.refunds.some((r) => r.status !== "PROCESSED" && r.status !== "FAILED");
  // A payment still pending or authorized at the provider can yet be taken (and would then be refunded): keep polling.
  const inFlight = (booking.payment?.open_attempts ?? 0) > 0;
  const extensionId = order.extension_id ?? null;
  if (extensionId) {
    // Extension payment: its outcome is the extension's. Pay is offered only while the hold is live.
    const ext = booking.extension?.extension_id === extensionId ? booking.extension : null;
    const live = !!ext && (ext.status === "HELD" || ext.status === "PENDING_PAYMENT") && !!ext.hold_expires_at
      && Date.parse(ext.hold_expires_at) > Date.parse(booking.server_now);
    const done = !!ext && ["APPLIED", "EXPIRED", "CANCELLED", "DECLINED"].includes(ext.status) && !hasRefund;
    return {
      payment_order_id: order.payment_order_id, booking_id: order.booking_id, extension_id: extensionId, state: order.state,
      expected_amount_paise: order.expected_amount_paise, currency: "INR", expires_at: order.expires_at, booking,
      checkout: live ? checkoutConfig(getPaymentServices(), order, client) : null, next_poll_after_seconds: done ? null : 3
    };
  }
  const settled = TERMINAL.has(booking.status) && !hasRefund && !inFlight && booking.payment?.allocation !== "UNDER_REVIEW";
  return {
    payment_order_id: order.payment_order_id,
    booking_id: order.booking_id,
    extension_id: null,
    state: order.state,
    expected_amount_paise: order.expected_amount_paise,
    currency: "INR",
    expires_at: order.expires_at,
    booking,
    checkout: booking.hold_active ? checkoutConfig(getPaymentServices(), order, client) : null,
    next_poll_after_seconds: settled ? null : 3
  };
}

export async function loadPaymentOrderStatus(claims: VerifiedClaims, orderId: string, client: CheckoutReturnTarget) {
  const order = await asUser(getPaymentServices().sql, claims, (tx) => customerPaymentOrder(tx, orderId));
  return toPaymentOrderStatus(order, client);
}
