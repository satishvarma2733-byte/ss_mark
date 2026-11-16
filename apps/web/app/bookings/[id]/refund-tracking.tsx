// Figma "E · Customer web · Cancellation and refund tracking": a cancelled booking with its refund breakdown, the
// accepted policy and a refund timeline. Amounts come from the booking and its refund rows; nothing here is estimated.
import { Check, Clock3, Info } from "lucide-react";
import { cancellationNotice, cancellationPolicySummary, refundReasonText, refundStatusText, type BookingDetail } from "@simply-sit/contracts";
import { formatInrPaise, formatVenueTime } from "../../../lib/format";
import { VenueIdentity, longDate } from "../../../components/booking-parts";
import { PrintButton } from "../../../components/print-button";

const when = (iso: string, tz: string) =>
  `${new Intl.DateTimeFormat("en-IN", { timeZone: tz, day: "numeric", month: "short" }).format(new Date(iso))} · ${formatVenueTime(iso, tz)} IST`;

export function RefundTracking({ b, photo }: { b: BookingDetail; photo: { id: string; alt_text: string } | null }) {
  const tz = b.venue.timezone;
  const guests = `${b.party_size} ${b.party_size === 1 ? "guest" : "guests"}`;
  const paid = b.payment && b.payment.payment_state === "CAPTURED" ? b.total_paise + b.extensions_applied.reduce((s, x) => s + x.amount_paise, 0) : 0;
  const refunded = b.refunds.reduce((s, r) => s + r.amount_paise, 0);
  const credited = b.refunds.length > 0 && b.refunds.every((r) => r.status === "PROCESSED");
  const latest = b.refunds.at(-1);

  return (
    <main className="customer-page">
      <p className="page-crumbs">
        SIMPLY SIT / <a href="/bookings">My bookings</a> / {b.public_ref}
      </p>
      <div className="customer-page-intro">
        <h1>Plans change. We’ll keep you updated.</h1>
        <p className="lede">
          <span data-testid="booking-ref">{b.public_ref}</span>
          {b.cancelled_at ? ` · Cancelled ${longDate(b.cancelled_at, tz)}, ${formatVenueTime(b.cancelled_at, tz)} IST` : ""}
        </p>
      </div>
      <div className="pill-row">
        <span className="status-pill danger" data-testid="booking-status">
          Cancelled
        </span>
        <span className="status-pill neutral">Pass no longer valid</span>
        {b.venue.is_synthetic ? <span className="status-pill neutral">Synthetic demo booking · mock refund, no real money</span> : null}
      </div>

      <div className="book-layout refund-layout">
        <div className="book-main">
          <section className="card book-card" aria-label="Booking">
            <VenueIdentity photo={photo} venueName={b.venue.name} detail={`${b.table.label} · ${guests}`} reference={b.public_ref} />
            <hr />
            <p className="book-when">
              {longDate(b.start_at, tz)} · {formatVenueTime(b.start_at, tz)}–{formatVenueTime(b.end_at, tz)} IST
            </p>
            <span className="status-pill sage">
              <img src="/design/status-dot-brand.svg" alt="" width={5} height={5} />
              Cancelled · Table released
            </span>
            {b.confirmed_at ? (
              <p className="book-when" data-testid="cancelled-notice">
                {cancellationNotice(b.cancel_reason)}
              </p>
            ) : null}
          </section>

          <section className="card book-card" aria-labelledby="breakdown-heading">
            <h2 id="breakdown-heading">Your refund breakdown</h2>
            <dl className="detail-rows">
              <div>
                <dt>Original payment</dt>
                <dd>{formatInrPaise(paid)}</dd>
              </div>
              <div className="total-row">
                <dt>{credited ? "Refunded" : "Refund being processed"}</dt>
                <dd>{formatInrPaise(refunded)}</dd>
              </div>
              <div>
                <dt>Total retained</dt>
                <dd>{formatInrPaise(Math.max(0, paid - refunded))}</dd>
              </div>
            </dl>
            {b.refunds.map((r) => (
              <p key={r.refund_id} className="book-note" data-testid="refund-line">
                {formatInrPaise(r.amount_paise)} ({refundReasonText(r.reason_code)}) - {refundStatusText(r.status)}
              </p>
            ))}
            {b.refunds.length === 0 ? (
              <span className="status-pill neutral">No refund due under the accepted policy</span>
            ) : credited ? (
              <span className="status-pill">
                <img src="/design/status-dot-available.svg" alt="" width={5} height={5} />
                Refund confirmed by the payment provider
              </span>
            ) : (
              <span className="status-pill warm">Refund pending · Not yet credited</span>
            )}
          </section>

          <section className="card book-card" aria-labelledby="policy-heading">
            <h2 id="policy-heading">Accepted cancellation policy</h2>
            <p className="book-when">{cancellationPolicySummary(b.policy_snapshot)}</p>
            <p className="field-hint">
              Policy version {b.policy_snapshot.policy_version}, accepted at booking. Current venue rules are not applied retroactively.
            </p>
          </section>
        </div>

        <div className="book-side">
          <section className="card book-card" aria-labelledby="follow-heading">
            <h2 id="follow-heading">Follow your refund</h2>
            <ol className="stay-timeline">
              <li>
                <span className="marker done" aria-hidden="true">
                  <Check size={13} />
                </span>
                <div>
                  <strong>Cancellation accepted</strong>
                  <p>{b.cancelled_at ? `${when(b.cancelled_at, tz)} · Table released` : "Table released"}</p>
                </div>
              </li>
              {latest ? (
                <>
                  <li>
                    <span className="marker done" aria-hidden="true">
                      <Check size={13} />
                    </span>
                    <div>
                      <strong>Refund request created</strong>
                      <p>
                        {when(latest.created_at, tz)} · {formatInrPaise(latest.amount_paise)}
                      </p>
                    </div>
                  </li>
                  <li>
                    <span className={`marker ${credited ? "done" : "wait"}`} aria-hidden="true">
                      {credited ? <Check size={13} /> : <Clock3 size={13} />}
                    </span>
                    <div>
                      <strong>Provider processing</strong>
                      <p>{refundStatusText(latest.status)}</p>
                    </div>
                  </li>
                  <li>
                    <span className={`marker ${credited ? "done" : "wait"}`} aria-hidden="true">
                      {credited ? <Check size={13} /> : <Clock3 size={13} />}
                    </span>
                    <div>
                      <strong>Credit to your original payment method</strong>
                      <p>{credited ? "Confirmed by the payment provider" : "Awaiting provider confirmation"}</p>
                    </div>
                  </li>
                </>
              ) : (
                <li>
                  <span className="marker done" aria-hidden="true">
                    <Check size={13} />
                  </span>
                  <div>
                    <strong>No refund due</strong>
                    <p>The cancellation came after the refund deadline in the accepted policy.</p>
                  </div>
                </li>
              )}
            </ol>
            <p className="field-hint">We notify you when the provider confirms the credit.</p>
          </section>
          <div className="notice info">
            <Info size={20} aria-hidden="true" />
            <div>
              <strong>Refund still missing?</strong>
              <p>Contact support with your booking ID {b.public_ref}. Never share your UPI PIN, OTP or full account details.</p>
            </div>
          </div>
          <div className="action-pair">
            <a className="button" href="/help">
              Contact support
            </a>
            <PrintButton label="Print statement" />
          </div>
        </div>
      </div>
    </main>
  );
}
