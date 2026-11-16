import { notFound, redirect } from "next/navigation";
import { Info } from "lucide-react";
import { cancellationPolicySummary, refundReasonText, refundStatusText } from "@simply-sit/contracts";
import { DomainError, asAnon, getDb, venuePhotos } from "@simply-sit/db";
import { resolveIdentity } from "../../../lib/auth/identity";
import { loadBookingDetail } from "../../../lib/bookings";
import { FOOD_RULE_LABEL, formatInrPaise, formatVenueTime } from "../../../lib/format";
import { bookingStatusLabel } from "../../../lib/labels";
import { qrSvg } from "../../../lib/qr";
import { VenuePhoto } from "../../../components/venue-photo";
import { VenueIdentity, longDate } from "../../../components/booking-parts";
import { PrintButton } from "../../../components/print-button";
import { RefundTracking } from "./refund-tracking";

export const dynamic = "force-dynamic";

const HEADLINE: Record<string, string> = {
  CONFIRMED: "See you soon.",
  CHECKED_IN: "Enjoy your time.",
  COMPLETED: "Thanks for visiting.",
  CANCELLED: "This booking is cancelled.",
  EXPIRED: "This hold has ended."
};

// C08 - Figma "E · Customer web · Confirmed booking pass". Owner-only: arrival QR and PIN (confirmed only), time,
// rules, receipt and states. Cancellation (C10) is offered while CONFIRMED and before the start; the server decides the
// refund. Another customer's booking ID shows the same not-found page as a missing one.
export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const identity = await resolveIdentity();
  if (identity.kind !== "user") redirect(`/sign-in?redirect_path=${encodeURIComponent(`/bookings/${id}`)}`);
  const b = await loadBookingDetail(identity.claims, id).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  if (b.status === "HOLD" || b.status === "PENDING_PAYMENT") {
    if (b.hold_active) redirect(`/checkout/${id}`);
  }
  const photos = await asAnon(getDb(), (tx) => venuePhotos(tx, b.venue.id)).catch(() => []);
  const tz = b.venue.timezone;
  const policy = b.policy_snapshot;
  const cancellable = b.status === "CONFIRMED" && Date.parse(b.server_now) < Date.parse(b.start_at);
  const timeRange = `${formatVenueTime(b.start_at, tz)}–${formatVenueTime(b.end_at, tz)} IST`;
  const guests = `${b.party_size} ${b.party_size === 1 ? "guest" : "guests"}`;
  const statusLabel = bookingStatusLabel(b.status, b.hold_active);
  const positive = b.status === "CONFIRMED" || b.status === "CHECKED_IN" || b.status === "COMPLETED";
  const checkInOpens = new Date(Date.parse(b.start_at) - 15 * 60_000).toISOString();
  const paid = b.total_paise + b.extensions_applied.reduce((sum, x) => sum + x.amount_paise, 0);
  const directions = `https://www.openstreetmap.org/?mlat=${b.venue.lat}&mlon=${b.venue.lng}#map=17/${b.venue.lat}/${b.venue.lng}`;
  if (b.status === "CANCELLED") return <RefundTracking b={b} photo={photos[0] ?? null} />;

  return (
    <main className="customer-page">
      <p className="page-crumbs">
        SIMPLY SIT / <a href="/bookings">My bookings</a> / {b.public_ref}
      </p>
      <div className="customer-page-intro">
        <h1>{HEADLINE[b.status] ?? b.venue.name}</h1>
        <p className="lede">
          <span data-testid="booking-ref">{b.public_ref}</span> · {b.venue.name} · {longDate(b.start_at, tz)}
        </p>
      </div>
      <div className="pill-row">
        <span className={`status-pill${positive ? "" : " neutral"}`} data-testid="booking-status">
          {positive ? <img src="/design/status-dot-available.svg" alt="" width={5} height={5} /> : null}
          {statusLabel}
        </span>
        {b.venue.is_synthetic ? <span className="status-pill neutral">Synthetic demo booking · mock payment, no real charge</span> : null}
      </div>

      <div className="book-layout checkout-layout">
        <div className="book-main">
          <VenuePhoto mediaId={photos[0]?.id ?? null} alt={photos[0]?.alt_text ?? ""} className="pass-photo" width={1240} height={520} />
          <section className="card book-card" aria-label="Booking">
            <VenueIdentity photo={photos[1] ?? photos[0] ?? null} venueName={b.venue.name} detail={`${b.table.label} · ${guests}`} reference={b.public_ref} />
            <hr />
            <p className="book-when">
              {longDate(b.start_at, tz)} · {timeRange}
            </p>
          </section>

          <section className="card book-card" aria-labelledby="getting-heading">
            <h2 id="getting-heading">Getting there</h2>
            <p className="book-when strong">
              {b.venue.name} · {b.venue.locality}
            </p>
            <p className="book-when">{b.venue.address}</p>
            <p className="book-note">{policy.handover_instructions}</p>
            <div className="action-pair">
              <a className="button" href={directions} rel="noreferrer" target="_blank">
                Directions ↗<span className="visually-hidden"> (opens OpenStreetMap in a new tab; fictional demo coordinates)</span>
              </a>
              <PrintButton label="Print receipt" />
            </div>
          </section>

          <div className="notice info">
            <Info size={20} aria-hidden="true" />
            <div>
              <strong>Make yourself at home, thoughtfully</strong>
              <p>
                No compulsory food order. Outside food: {FOOD_RULE_LABEL[policy.byo_food].toLowerCase()}. Outside deliveries:{" "}
                {FOOD_RULE_LABEL[policy.outside_delivery].toLowerCase()}. {policy.house_rules} Leave {b.table.label} by {formatVenueTime(b.end_at, tz)}{" "}
                for its cleaning buffer.
              </p>
            </div>
          </div>
        </div>

        <div className="book-side">
          {b.arrival && b.status === "CONFIRMED" ? (
            <section className="card book-card arrival" aria-labelledby="arrival-heading" data-testid="arrival">
              <h2 id="arrival-heading">Your check-in pass</h2>
              <div className="pass-credential">
                <div className="pass-qr" dangerouslySetInnerHTML={{ __html: qrSvg(b.arrival.qr_token, "Check-in QR code for this booking") }} />
                <p className="pass-pin" aria-label={`PIN ${b.arrival.pin}`}>
                  <span className="pin" data-testid="arrival-pin">
                    {b.arrival.pin}
                  </span>
                </p>
                <p className="book-when">Show this at reception, or tell staff your reference and PIN. Keep this code private.</p>
              </div>
              <hr />
              <dl className="detail-rows">
                <div>
                  <dt>Check-in opens</dt>
                  <dd>{formatVenueTime(checkInOpens, tz)} IST</dd>
                </div>
                <div>
                  <dt>Reserved time</dt>
                  <dd>{timeRange}</dd>
                </div>
                <div>
                  <dt>Arrive by</dt>
                  <dd>{policy.grace_minutes} min after start</dd>
                </div>
              </dl>
            </section>
          ) : null}

          {b.status === "CHECKED_IN" ? (
            <div className="notice info">
              <Info size={20} aria-hidden="true" />
              <div>
                <strong>You are checked in</strong>
                <p>Enjoy your time. Your table is yours until {formatVenueTime(b.end_at, tz)} IST.</p>
                {Date.parse(b.server_now) < Date.parse(b.end_at) ? (
                  <a className="text-link" href={`/bookings/${b.booking_id}/extend`} data-testid="extend-link">
                    Need more time? →
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
          {b.status === "COMPLETED" ? (
            <div className="notice info" data-testid="review-prompt">
              <Info size={20} aria-hidden="true" />
              <div>
                <strong>{b.review ? `Your review: ${b.review.rating} of 5 (${b.review.moderation_status.toLowerCase()}).` : "How was your visit?"}</strong>
                <a className="text-link" href={`/bookings/${b.booking_id}/review`}>
                  {b.review ? "View review →" : "Rate your visit →"}
                </a>
              </div>
            </div>
          ) : null}

          <section className="card book-card" aria-labelledby="receipt-heading">
            <h2 id="receipt-heading">Payment &amp; cancellation</h2>
            <dl className="detail-rows">
              <div>
                <dt>Table time</dt>
                <dd>{formatInrPaise(b.price_snapshot.base_paise)}</dd>
              </div>
              <div>
                <dt>Platform fee</dt>
                <dd>{formatInrPaise(b.price_snapshot.service_fee_paise)}</dd>
              </div>
              {b.extensions_applied.map((x) => (
                <div key={x.extension_id} data-testid="extension-line">
                  <dt>Extra {x.additional_minutes} minutes</dt>
                  <dd>{formatInrPaise(x.amount_paise)}</dd>
                </div>
              ))}
              <div className="total-row">
                <dt>{b.payment && b.payment.payment_state === "CAPTURED" ? "Amount paid" : "Booking total"}</dt>
                <dd>{formatInrPaise(paid)}</dd>
              </div>
            </dl>
            <p className="book-note">
              Payment: {b.payment ? `${b.payment.payment_state.toLowerCase()} (mock provider, ${b.payment.environment.toLowerCase()} mode)` : "none"}
            </p>
            {b.refunds.length > 0 ? (
              <div className="refund-lines" aria-label="Refunds">
                {b.refunds.map((r) => (
                  <p key={r.refund_id} className="book-when" data-testid="refund-line">
                    {formatInrPaise(r.amount_paise)} ({refundReasonText(r.reason_code)}) - {refundStatusText(r.status)}
                  </p>
                ))}
              </div>
            ) : null}
            <p className="book-when">{cancellationPolicySummary(policy)}</p>
            {cancellable ? (
              <a className="button secondary" href={`/bookings/${b.booking_id}/cancel`} data-testid="cancel-booking-link">
                Manage booking
              </a>
            ) : null}
          </section>
          <a className="button" href="/bookings">
            View my bookings
          </a>
        </div>
      </div>
    </main>
  );
}
