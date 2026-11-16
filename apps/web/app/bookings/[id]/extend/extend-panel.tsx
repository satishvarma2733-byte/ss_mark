"use client";

// C11. Every deadline shown comes from the server and is counted against the server clock from the last response;
// the database decides. "Approved" never means the time is yours: the hold step checks availability again.
// Layout: Figma "E · Customer web · Active booking and extension" (stay card, extra-time choice, timeline, price and
// review column). The price shown before the venue answers is an estimate from the booked hourly rate.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clock3, Info } from "lucide-react";
import type { BookingDetail, Extension, PaymentOrderStatus } from "@simply-sit/contracts";
import { apiCall, newIdempotencyKey } from "../../../../lib/client-api";
import { formatInrPaise, formatVenueTime } from "../../../../lib/format";
import { bookingStatusLabel } from "../../../../lib/labels";

const OPEN = new Set(["REQUESTED", "APPROVED", "HELD", "PENDING_PAYMENT"]);

function remaining(deadline: string | null, now: number) {
  if (!deadline) return 0;
  return Math.max(0, Math.floor((Date.parse(deadline) - now) / 1000));
}
const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const plus = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();

export function ExtendPanel({ initial }: { initial: BookingDetail }) {
  const [booking, setBooking] = useState(initial);
  const [offset, setOffset] = useState(() => Date.parse(initial.server_now) - Date.now());
  const [now, setNow] = useState(() => Date.now());
  const increment = Number(initial.policy_snapshot.increment_minutes) || 30;
  const maximum = Number(initial.policy_snapshot.maximum_minutes) || 240;
  // Offer useful amounts: steps of at least 15 minutes that are still whole multiples of the venue's booking step.
  const step = increment >= 15 ? increment : Math.ceil(15 / increment) * increment;
  const [minutes, setMinutes] = useState(step);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: string; text: string } | null>(null);
  const [acceptedPrice, setAcceptedPrice] = useState<number | null>(null);
  // One key per user action, kept across a retry after a lost response, replaced once the server has answered.
  const keys = useRef({ request: newIdempotencyKey(), hold: newIdempotencyKey() });
  const ext: Extension | null = booking.extension ?? null;
  const open = !!ext && OPEN.has(ext.status);

  const refresh = useCallback(async () => {
    const result = await apiCall<BookingDetail>("GET", `/api/v1/bookings/${initial.booking_id}`);
    if (result.ok) {
      setBooking(result.data);
      setOffset(Date.parse(result.data.server_now) - Date.now());
    }
  }, [initial.booking_id]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    // Staff decisions and payment results arrive from the server; poll while something is open.
    const poll = setInterval(() => void refresh(), 4000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [refresh]);

  const serverNow = now + offset;
  const tz = booking.venue.timezone;
  const usedMinutes = Math.round((Date.parse(booking.end_at) - Date.parse(booking.start_at)) / 60_000);
  const choices: number[] = [];
  for (let m = step; usedMinutes + m <= maximum && choices.length < 4; m += step) choices.push(m);
  const eligible = booking.status === "CHECKED_IN" && serverNow < Date.parse(booking.end_at);
  const minutesLeft = Math.max(0, Math.ceil((Date.parse(booking.end_at) - serverNow) / 60_000));
  const buffer = booking.policy_snapshot.buffer_minutes;
  const price = booking.price_snapshot;
  const paidSoFar = booking.total_paise + booking.extensions_applied.reduce((sum, x) => sum + x.amount_paise, 0);
  const shownMinutes = open && ext ? ext.additional_minutes : minutes;
  const estimate = Math.round((price.hourly_paise * shownMinutes) / 60);
  const extraPaise = open && ext ? acceptedPrice ?? ext.amount_paise : estimate;
  const newEnd = open && ext ? ext.requested_end_at : plus(booking.end_at, minutes);
  const maxEnd = plus(booking.start_at, maximum);

  async function request() {
    setBusy("request");
    setMessage(null);
    const result = await apiCall<Extension>("POST", `/api/v1/bookings/${booking.booking_id}/extension-requests`, {
      idempotencyKey: keys.current.request, body: { additional_minutes: minutes, expected_version: booking.version }
    });
    setBusy(null);
    if (result.ok) {
      keys.current.request = newIdempotencyKey();
      await refresh();
    } else {
      setMessage({ tone: "status-error", text: result.code === "OUTSIDE_HOURS" ? "The venue closes before that. Choose less time." : result.message });
      if (result.code !== "NETWORK") keys.current.request = newIdempotencyKey();
    }
  }

  async function payFor(current: Extension) {
    let result = await apiCall<PaymentOrderStatus>("POST", `/api/v1/extension-requests/${current.extension_id}/checkout`, {
      body: { expected_version: current.version, client: "web" }
    });
    for (let i = 0; result.ok && !result.data.checkout && i < 10; i += 1) {
      setMessage({ tone: "", text: "Setting up the secure payment page…" });
      await new Promise((r) => setTimeout(r, 2000));
      result = await apiCall<PaymentOrderStatus>("GET", `/api/v1/payment-orders/${result.data.payment_order_id}?client=web`);
    }
    if (result.ok && result.data.checkout) {
      window.location.assign(result.data.checkout.checkout_url);
      return;
    }
    setBusy(null);
    setMessage({ tone: "status-error", text: result.ok ? "The payment provider is not responding. Try Pay again while the time is held." : result.message });
    await refresh();
  }

  async function holdAndPay() {
    if (!ext) return;
    setBusy("pay");
    setMessage(null);
    const hold = await apiCall<Extension>("POST", `/api/v1/extension-requests/${ext.extension_id}/hold`, {
      idempotencyKey: keys.current.hold, body: { accepted_price_paise: acceptedPrice ?? ext.amount_paise, expected_version: ext.version }
    });
    if (!hold.ok) {
      setBusy(null);
      if (hold.code !== "NETWORK") keys.current.hold = newIdempotencyKey();
      if (hold.code === "QUOTE_CHANGED" && typeof hold.details?.amount_paise === "number") {
        setAcceptedPrice(hold.details.amount_paise);
        setMessage({ tone: "status-warning", text: `The price is now ${formatInrPaise(hold.details.amount_paise)}. Confirm again to continue.` });
      } else if (hold.code === "SLOT_UNAVAILABLE") {
        setMessage({ tone: "status-error", text: "Someone else has booked this table right after you, so it cannot be extended. Your booking is unchanged." });
      } else setMessage({ tone: "status-error", text: hold.message });
      await refresh();
      return;
    }
    await payFor(hold.data);
  }

  async function cancel() {
    if (!ext) return;
    setBusy("cancel");
    const result = await apiCall("POST", `/api/v1/extension-requests/${ext.extension_id}/cancel`, { body: {} });
    setBusy(null);
    if (!result.ok) setMessage({ tone: "status-error", text: result.message });
    await refresh();
  }

  return (
    <div className="book-layout checkout-layout" data-testid="extend-panel" aria-live="polite">
      <div className="book-main">
        <section className="card book-card" aria-labelledby="stay-heading">
          <h2 id="stay-heading">{booking.status === "CHECKED_IN" ? "Your stay is in progress" : "Your booking"}</h2>
          <span className={`status-pill${booking.status === "CHECKED_IN" ? "" : " neutral"}`}>
            {booking.status === "CHECKED_IN" ? <img src="/design/status-dot-available.svg" alt="" width={5} height={5} /> : null}
            {bookingStatusLabel(booking.status, booking.hold_active)}
          </span>
          {eligible ? (
            <p className="stay-remaining">
              {minutesLeft} {minutesLeft === 1 ? "minute" : "minutes"}, all yours.
            </p>
          ) : null}
          <dl className="detail-rows">
            <div>
              <dt>Current reserved end</dt>
              <dd>{formatVenueTime(booking.end_at, tz)} IST</dd>
            </div>
          </dl>
          <p className="book-when">
            {booking.venue.name} · {booking.table.label} · {booking.party_size} {booking.party_size === 1 ? "guest" : "guests"}
          </p>
          <p className="book-note">
            Paid so far {formatInrPaise(paidSoFar)}. Your end time stays {formatVenueTime(booking.end_at, tz)} unless an extension is both available and
            payment-verified.
          </p>
          {ext?.status === "APPLIED" && !open ? (
            <p className="status-success" data-testid="ext-applied">
              Extended by {ext.additional_minutes} minutes. Payment verified.
            </p>
          ) : null}
        </section>

        {eligible && !open && choices.length > 0 ? (
          <section className="card book-card" aria-labelledby="choose-heading">
            <h2 id="choose-heading">Choose extra time</h2>
            <fieldset className="choice-radios" data-testid="ext-minutes">
              <legend className="visually-hidden">Extra time</legend>
              {choices.map((m) => (
                <label key={m} className={`choice-pill${m === minutes ? " selected" : ""}`}>
                  <input type="radio" name="ext-minutes" value={m} checked={m === minutes} onChange={() => setMinutes(m)} />
                  +{m} min · {formatVenueTime(plus(booking.end_at, m), tz)}
                </label>
              ))}
            </fieldset>
            <dl className="detail-rows">
              <div>
                <dt>Selected extension interval</dt>
                <dd>
                  {formatVenueTime(booking.end_at, tz)}–{formatVenueTime(plus(booking.end_at, minutes), tz)}
                </dd>
              </div>
              <div>
                <dt>Longest booking allowed ends</dt>
                <dd>{formatVenueTime(maxEnd, tz)} IST</dd>
              </div>
            </dl>
            <div className="notice info">
              <Info size={20} aria-hidden="true" />
              <div>
                <strong>Another guest’s booking stays protected</strong>
                <p>The full {buffer}-minute cleaning buffer must fit before the next booking on this table. Extensions never move the next stay.</p>
              </div>
            </div>
          </section>
        ) : null}

        <section className="card book-card" aria-labelledby="timeline-heading">
          <h2 id="timeline-heading">Before your end time</h2>
          <ol className="stay-timeline">
            <li>
              <span className="marker done" aria-hidden="true">
                <Check size={13} />
              </span>
              <div>
                <strong>{formatVenueTime(new Date(serverNow).toISOString(), tz)} · {booking.status === "CHECKED_IN" ? "Active stay" : "Now"}</strong>
                <p>{ext?.status === "APPLIED" ? `Extended by ${ext.additional_minutes} minutes` : "No extension confirmed yet"}</p>
              </div>
            </li>
            <li>
              <span className="marker wait" aria-hidden="true">
                <Clock3 size={13} />
              </span>
              <div>
                <strong>{formatVenueTime(booking.end_at, tz)} · Current departure</strong>
                <p>Please leave by the paid end time unless an extension is verified.</p>
              </div>
            </li>
            <li>
              <span className="marker wait" aria-hidden="true">
                <Clock3 size={13} />
              </span>
              <div>
                <strong>Cleaning buffer</strong>
                <p>
                  {formatVenueTime(booking.end_at, tz)}–{formatVenueTime(plus(booking.end_at, buffer), tz)}; moves only after a verified extension.
                </p>
              </div>
            </li>
          </ol>
          <a className="button secondary" href="/help">
            Contact venue / Get help
          </a>
        </section>
      </div>

      <div className="book-side">
        {eligible || open ? (
          <section className="card book-card" aria-labelledby="more-heading">
            <h2 id="more-heading">{shownMinutes} minutes more</h2>
            <dl className="detail-rows">
              <div>
                <dt>
                  Table · {formatInrPaise(price.hourly_paise)} × {shownMinutes / 60} hr
                </dt>
                <dd>{open ? formatInrPaise(extraPaise) : `≈ ${formatInrPaise(estimate)}`}</dd>
              </div>
              <div className="total-row">
                <dt>Additional payment</dt>
                <dd>{open ? formatInrPaise(extraPaise) : `≈ ${formatInrPaise(estimate)}`}</dd>
              </div>
            </dl>
            <p className="field-hint">
              {open ? "Price set by the venue for this request." : "Estimate from your booked rate. The venue confirms the exact price when it answers."}
            </p>
          </section>
        ) : null}

        <section className="card book-card" aria-labelledby="review-heading">
          <h2 id="review-heading">Review your extension</h2>
          {eligible || open ? (
            <dl className="detail-rows">
              <div>
                <dt>Paid so far</dt>
                <dd>{formatInrPaise(paidSoFar)}</dd>
              </div>
              <div>
                <dt>Additional payment</dt>
                <dd>{open ? formatInrPaise(extraPaise) : `≈ ${formatInrPaise(estimate)}`}</dd>
              </div>
              <div className="total-row">
                <dt>Revised total if verified</dt>
                <dd>{open ? formatInrPaise(paidSoFar + extraPaise) : `≈ ${formatInrPaise(paidSoFar + estimate)}`}</dd>
              </div>
              <div>
                <dt>New end if confirmed</dt>
                <dd>{formatVenueTime(newEnd, tz)} IST</dd>
              </div>
            </dl>
          ) : null}

          {ext?.status === "REQUESTED" ? (
            <div className="ext-state" data-testid="ext-requested">
              <p className="book-when">
                You asked for {ext.additional_minutes} more minutes. Waiting for the venue to answer:{" "}
                <strong role="timer" aria-live="off">{mmss(remaining(ext.request_expires_at, serverNow))}</strong>
              </p>
              <p className="field-hint">Nothing is reserved yet. Your booking still ends at {formatVenueTime(ext.original_end_at, tz)} IST.</p>
            </div>
          ) : null}

          {ext?.status === "APPROVED" ? (
            <div className="ext-state" data-testid="ext-approved">
              <span className="status-pill">
                <img src="/design/status-dot-available.svg" alt="" width={5} height={5} />
                Approved · confirm availability and pay
              </span>
              <p className="book-when">
                Confirm within <strong role="timer" aria-live="off">{mmss(remaining(ext.approval_expires_at, serverNow))}</strong>.
              </p>
              <button className="button" type="button" disabled={busy !== null} aria-busy={busy === "pay"} onClick={() => void holdAndPay()} data-testid="ext-pay">
                {busy === "pay" ? "Checking availability…" : `Check availability & pay ${formatInrPaise(acceptedPrice ?? ext.amount_paise)}`}
              </button>
            </div>
          ) : null}

          {ext && (ext.status === "HELD" || ext.status === "PENDING_PAYMENT") ? (
            <div className="ext-state" data-testid="ext-held">
              <p className="book-when">
                The extra time is held for you for <strong role="timer" aria-live="off">{mmss(remaining(ext.hold_expires_at, serverNow))}</strong>.
                {ext.status === "PENDING_PAYMENT" ? " A payment may already be in progress." : ""}
              </p>
              <button className="button" type="button" disabled={busy !== null} onClick={() => { setBusy("pay"); void payFor(ext); }} data-testid="ext-pay-held">
                Pay {formatInrPaise(ext.amount_paise)}
              </button>
            </div>
          ) : null}

          {ext?.status === "DECLINED" ? (
            <p className="book-when status-warning">The venue could not extend this time{ext.decline_reason ? `: ${ext.decline_reason}` : "."}</p>
          ) : null}
          {ext && (ext.status === "EXPIRED" || ext.status === "CANCELLED") && ext.end_reason !== "CHECKED_OUT" ? (
            <p className="book-when">The last extension request ended without changing your booking.</p>
          ) : null}

          {open ? (
            <button className="button secondary" type="button" disabled={busy !== null} onClick={() => void cancel()}>
              Withdraw request
            </button>
          ) : eligible && choices.length > 0 ? (
            <>
              <label className="check-row">
                <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                <span>I understand the venue confirms the price, and my end time changes only after a verified payment.</span>
              </label>
              <button className="button" type="button" disabled={busy !== null || !accepted} onClick={() => void request()} data-testid="ext-request">
                {busy === "request" ? "Asking the venue…" : `Ask the venue for ${minutes} minutes`}
              </button>
              <p className="field-hint">
                The venue answers within five minutes. Then we check the next interval, hold it briefly and verify payment before changing your end time.
              </p>
            </>
          ) : (
            <p className="book-when" data-testid="ext-unavailable">
              {booking.status !== "CHECKED_IN"
                ? "More time can be requested once you are checked in."
                : choices.length === 0
                  ? "This booking is already at the longest length allowed."
                  : "This booking has ended."}
            </p>
          )}
          {message ? (
            <p className={`book-when ${message.tone}`} role="alert">
              {message.text}
            </p>
          ) : null}
          <a className="button secondary" href={`/bookings/${booking.booking_id}`}>
            Keep original {formatVenueTime(booking.end_at, tz)} end
          </a>
        </section>
      </div>
    </div>
  );
}
