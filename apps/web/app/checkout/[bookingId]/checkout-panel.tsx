"use client";

// The countdown is presentation only: it is anchored to the server clock from the last response, and the database
// decides expiry. Pay persists the expected payment first, then sends the customer to the provider's checkout.
// Layout: Figma "E · Customer web · Checkout and payment". The payment method is chosen on the provider's secure page;
// this app never collects a UPI ID, card or PIN.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, Info } from "lucide-react";
import { cancellationPolicySummary, type BookingDetail, type PaymentOrderStatus } from "@simply-sit/contracts";
import { apiCall, newIdempotencyKey } from "../../../lib/client-api";
import { FOOD_RULE_LABEL, formatInrPaise, formatVenueTime } from "../../../lib/format";
import { PriceSummary, VenueIdentity, longDate } from "../../../components/booking-parts";

export function CheckoutPanel({ initial, photo }: { initial: BookingDetail; photo: { id: string; alt_text: string } | null }) {
  const [booking, setBooking] = useState(initial);
  const [offsetMs, setOffsetMs] = useState(() => Date.parse(initial.server_now) - Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<"pay" | "cancel" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const cancelKey = useMemo(() => newIdempotencyKey(), []);

  const refresh = useCallback(async () => {
    const result = await apiCall<BookingDetail>("GET", `/api/v1/bookings/${initial.booking_id}`);
    if (result.ok) {
      setBooking(result.data);
      setOffsetMs(Date.parse(result.data.server_now) - Date.now());
      if (["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(result.data.status)) window.location.assign(`/bookings/${initial.booking_id}`);
    } else if (result.code === "NETWORK") setMessage(result.message);
  }, [initial.booking_id]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const deadline = booking.hold_expires_at ? Date.parse(booking.hold_expires_at) : 0;
  const remaining = Math.max(0, Math.floor((deadline - (now + offsetMs)) / 1000));
  const holdLive = (booking.status === "HOLD" || booking.status === "PENDING_PAYMENT") && remaining > 0;
  const paymentStarted = booking.payment && booking.payment.payment_state !== "NONE" && booking.payment.payment_state !== "FAILED";

  async function pay() {
    setBusy("pay");
    setMessage(null);
    let result = await apiCall<PaymentOrderStatus>("POST", `/api/v1/bookings/${booking.booking_id}/checkout`, {
      body: { expected_version: booking.version, client: "web" }
    });
    // 202: the provider order is still being set up (or its creation is uncertain). Poll; never create another.
    for (let i = 0; result.ok && !result.data.checkout && result.data.booking.hold_active && i < 10; i += 1) {
      setMessage("Setting up the secure payment page…");
      await new Promise((r) => setTimeout(r, 2000));
      result = await apiCall<PaymentOrderStatus>("GET", `/api/v1/payment-orders/${result.data.payment_order_id}?client=web`);
    }
    if (result.ok && result.data.checkout) {
      window.location.assign(result.data.checkout.checkout_url);
      return;
    }
    setBusy(null);
    if (result.ok) {
      setMessage("The payment provider is not responding. Your table is still held; try Pay again in a moment.");
      await refresh();
    } else if (result.code === "HOLD_EXPIRED") {
      await refresh();
    } else if (result.code === "STALE_VERSION") {
      await refresh();
      setMessage("This booking changed in another tab. Review it and try again.");
    } else {
      setMessage(result.message);
    }
  }

  async function cancel() {
    setBusy("cancel");
    const result = await apiCall("POST", `/api/v1/bookings/${booking.booking_id}/cancel-hold`, {
      idempotencyKey: cancelKey,
      body: { expected_version: booking.version }
    });
    setBusy(null);
    if (!result.ok) setMessage(result.message);
    await refresh();
  }

  const tz = booking.venue.timezone;
  const when = `${longDate(booking.start_at, tz)} · ${formatVenueTime(booking.start_at, tz)}–${formatVenueTime(booking.end_at, tz)} IST`;
  const guests = `${booking.party_size} ${booking.party_size === 1 ? "guest" : "guests"}`;
  const policy = booking.policy_snapshot;
  const total = formatInrPaise(booking.total_paise);

  return (
    <div className="checkout" data-testid="checkout">
      {holdLive ? (
        <div className="notice warm">
          <Clock3 size={20} aria-hidden="true" />
          <div>
            <strong role="timer" aria-live="off" data-testid="hold-countdown">
              Table held for {String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}
            </strong>
            <p>
              {policy.hold_minutes}-minute checkout hold. If it expires, check availability again before trying. Do not pay again while a payment is
              being verified.
            </p>
          </div>
        </div>
      ) : (
        <div className="notice error" role="alert" data-testid="hold-ended">
          <img src="/design/circle-alert-error.svg" alt="" width={20} height={20} />
          <div>
            <strong>{booking.status === "CANCELLED" ? "Table released" : "Your hold has ended"}</strong>
            <p>
              {booking.status === "CANCELLED"
                ? "You released this table. Nothing was charged for it."
                : "This hold has ended, so the table is no longer reserved for you."}
            </p>
            {booking.refunds.length > 0 ? <p>A payment arrived after the hold ended. A full refund is pending.</p> : null}
            <a className="text-link" href={`/venues/${booking.venue.slug}`}>
              Choose a time again →
            </a>
          </div>
        </div>
      )}

      <div className="book-layout checkout-layout">
        <div className="book-main">
          <section className="card book-card" aria-label="Booking">
            <VenueIdentity photo={photo} venueName={booking.venue.name} detail={`${booking.table.label} · ${guests}`} reference={booking.public_ref} />
            <hr />
            <p className="book-when">{when}</p>
            <span className={`status-pill ${holdLive ? "sage" : "neutral"}`}>
              {holdLive ? <img src="/design/status-dot-brand.svg" alt="" width={5} height={5} /> : null}
              {holdLive ? "On hold · Payment required" : booking.status === "CANCELLED" ? "Released" : "Hold ended"}
            </span>
          </section>

          <section className="card book-card" aria-labelledby="method-heading">
            <h2 id="method-heading">How you can pay</h2>
            <ul className="choice-pills" aria-label="Payment methods offered on the secure payment page">
              <li className="choice-pill">UPI</li>
              <li className="choice-pill">Debit / credit card</li>
              <li className="choice-pill">Net banking</li>
            </ul>
            <p className="book-when">
              Choose a method on the secure payment page. You will never be asked to enter a UPI PIN or card PIN on Simply Sit.
            </p>
            <div className="notice info">
              <Info size={20} aria-hidden="true" />
              <div>
                <strong>Confirmation needs verification</strong>
                <p>We check the provider’s response before a booking pass is issued. A debit alone does not reserve your table.</p>
              </div>
            </div>
          </section>

          <section className="card book-card" aria-labelledby="know-heading">
            <h2 id="know-heading">Know before you book</h2>
            <p className="book-when">{cancellationPolicySummary(policy)}</p>
            <p className="book-when">
              No compulsory food order · Outside food: {FOOD_RULE_LABEL[policy.byo_food].toLowerCase()} · Outside deliveries:{" "}
              {FOOD_RULE_LABEL[policy.outside_delivery].toLowerCase()} · {policy.buffer_minutes}-minute cleaning buffer.
            </p>
            <p className="book-when">✓ You accepted these rules (version {policy.policy_version}) when you held the table.</p>
            <p className="field-hint">The accepted price and policy version are saved with this booking.</p>
          </section>
        </div>

        <div className="book-side">
          <section className="card book-card" aria-labelledby="summary-heading">
            <h2 id="summary-heading">Payment summary</h2>
            <span className="status-pill neutral">Mock payment provider · test mode, no real charge</span>
            <PriceSummary price={booking.price_snapshot} totalPaise={booking.total_paise} />
            <p className="field-hint">No tax rate is approved yet. Refreshments are optional and paid at the venue.</p>
          </section>

          {holdLive ? (
            <section className="card book-card" aria-labelledby="pay-heading">
              <h2 id="pay-heading">Pay securely</h2>
              <p className="book-when">
                {booking.venue.name} · {booking.table.label}
                <br />
                {when} · {guests}
              </p>
              {paymentStarted && booking.payment ? (
                <p className="book-when status-warning">
                  A payment is already in progress.{" "}
                  <a href={`/payment/return?payment_order_id=${booking.payment.payment_order_id}`}>Check its status</a> before paying again.
                </p>
              ) : null}
              {booking.payment?.payment_state === "FAILED" ? (
                <p className="status-warning">The last payment attempt failed. You can try again while the table is held.</p>
              ) : null}
              <button className="button" type="button" onClick={() => void pay()} disabled={busy !== null} aria-busy={busy === "pay"} data-testid="pay">
                {busy === "pay" ? "Opening payment…" : `Pay ${total} securely`}
              </button>
              <p className="field-hint">
                Your booking is confirmed only after a verified payment. If an attempt fails, you can retry while the table is still held.
              </p>
              <a className="button secondary" href={`/venues/${booking.venue.slug}`}>
                Edit table or time
              </a>
              <button className="button secondary" type="button" onClick={() => void cancel()} disabled={busy !== null} data-testid="cancel-hold">
                {busy === "cancel" ? "Releasing…" : "Release this table"}
              </button>
            </section>
          ) : null}

          {message ? (
            <p className="auth-message" role="status" aria-live="polite">
              {message}
            </p>
          ) : null}

          <div className="notice info">
            <Info size={20} aria-hidden="true" />
            <div>
              <strong>Having trouble?</strong>
              <p>
                A failed attempt, a payment being verified and an expired hold are different states. Track any debit separately; support never asks
                for an OTP or PIN.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
