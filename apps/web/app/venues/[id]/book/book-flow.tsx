"use client";

// Quote -> accept -> hold. The server prices the slot; this screen only shows that quote and sends back its ID, the
// accepted policy hash and the total it displayed, so a changed price or rule is refused instead of charged.
// Layout: the right column of Figma "E · Customer web · Select table and time" (table card, payment summary, action).
import { useCallback, useEffect, useMemo, useState } from "react";
import { busyHourText, type Hold, type Quote } from "@simply-sit/contracts";
import { apiCall, newIdempotencyKey } from "../../../../lib/client-api";
import { FOOD_RULE_LABEL, formatInrPaise, formatVenueTime } from "../../../../lib/format";
import { Button, ButtonLink, Card, StatusPill } from "../../../../components/ui";

type Props = {
  venueId: string;
  slug: string;
  resourceId: string;
  tableLabel: string;
  capacity: number;
  tableFree: boolean;
  startAt: string;
  durationMinutes: number;
  durations: { minutes: number; label: string; href: string }[];
  partySize: number;
  whenLabel: string;
};
type Problem = { code: string; message: string };

const HINT: Record<string, string> = {
  SLOT_UNAVAILABLE: "Someone else just took this table, or it is no longer free. Choose another table or time.",
  QUOTE_EXPIRED: "The quote expired. Get a fresh quote to continue.",
  QUOTE_CHANGED: "The price or rules changed. Review the new quote.",
  POLICY_NOT_ACCEPTED: "Accept the current terms on your account page, then try again.",
  OUTSIDE_HOURS: "That time is outside the venue's bookable hours.",
  PARTY_TOO_LARGE: "This table is too small for your party.",
  VALIDATION_FAILED: "That time can no longer be booked (too soon, too far ahead or off the time grid). Choose another time.",
  ACCOUNT_DELETION_PENDING: "Your account has a pending deletion request, so new bookings are paused."
};

const hoursLabel = (minutes: number) => (minutes % 60 === 0 ? `${minutes / 60} ${minutes === 60 ? "hour" : "hours"}` : `${minutes} min`);

export function BookFlow(props: Props) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [holding, setHolding] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // One key per quote: a double click or a retried request cannot create a second hold.
  const holdKey = useMemo(() => (quote ? newIdempotencyKey() : null), [quote]);

  const loadQuote = useCallback(async () => {
    setLoading(true);
    setProblem(null);
    setAccepted(false);
    const result = await apiCall<Quote>("POST", "/api/v1/quotes", {
      body: {
        venue_id: props.venueId, resource_id: props.resourceId, start_at: props.startAt,
        duration_minutes: props.durationMinutes, party_size: props.partySize
      }
    });
    setLoading(false);
    if (result.ok) setQuote(result.data);
    else {
      setQuote(null);
      if (result.code === "AUTH_REQUIRED" || result.code === "SESSION_EXPIRED") window.location.assign(`/sign-in?redirect_path=${encodeURIComponent(location.pathname + location.search)}`);
      setProblem({ code: result.code, message: HINT[result.code] ?? result.message });
    }
  }, [props.venueId, props.resourceId, props.startAt, props.durationMinutes, props.partySize]);

  useEffect(() => {
    void loadQuote();
  }, [loadQuote]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function hold() {
    if (!quote || !holdKey) return;
    setHolding(true);
    setProblem(null);
    const result = await apiCall<Hold>("POST", "/api/v1/booking-holds", {
      idempotencyKey: holdKey,
      body: { quote_id: quote.quote_id, accepted_policy_hash: quote.policy_hash, expected_quote_total_paise: quote.price_snapshot.total_paise }
    });
    if (result.ok) {
      window.location.assign(`/checkout/${result.data.booking_id}`);
      return;
    }
    setHolding(false);
    setProblem({ code: result.code, message: HINT[result.code] ?? result.message });
  }

  const quoteExpired = quote ? Date.parse(quote.expires_at) <= now : false;
  const policy = quote?.policy_snapshot;
  const price = quote?.price_snapshot;

  return (
    <>
      <Card className="book-card" aria-labelledby="table-heading">
        <h2 id="table-heading">{props.tableLabel}</h2>
        <span className={`status-pill${props.tableFree ? "" : " warning"}`}>
          {props.tableFree ? <img src="/design/status-dot-available.svg" alt="" width={5} height={5} /> : null}
          {props.tableFree ? "Available" : "Not free for this time"} · Seats {props.capacity}
        </span>
        <div className="field">
          <label className="field-label" htmlFor="duration">
            Duration
          </label>
          <select id="duration" className="input" value={props.durationMinutes}
            onChange={(e) => {
              const next = props.durations.find((d) => d.minutes === Number(e.target.value));
              if (next) window.location.assign(next.href);
            }}>
            {props.durations.map((d) => (
              <option key={d.minutes} value={d.minutes}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <p className="book-when">{props.whenLabel}</p>
      </Card>

      {problem ? (
        <div className="notice error" role="alert" data-testid="book-problem">
          <img src="/design/circle-alert-error.svg" alt="" width={20} height={20} />
          <div>
            <strong>This table can’t be held</strong>
            <p>{problem.message}</p>
            {problem.code === "QUOTE_EXPIRED" || problem.code === "QUOTE_CHANGED" ? (
              <button className="text-link" type="button" onClick={() => void loadQuote()}>
                Get a fresh quote →
              </button>
            ) : (
              <a className="text-link" href={`/venues/${props.slug}`}>
                Choose another time →
              </a>
            )}
          </div>
        </div>
      ) : null}

      {loading ? <div className="skeleton" aria-label="Getting a quote" /> : null}

      {quote && policy && price ? (
        <>
          <Card className="book-card" aria-labelledby="quote-heading" data-testid="quote">
            <h2 id="quote-heading">Payment summary</h2>
            {price.synthetic ? <StatusPill tone="neutral">Sandbox pricing · synthetic, no real charge</StatusPill> : null}
            <dl className="detail-rows">
              <div>
                <dt>
                  Table · {formatInrPaise(price.hourly_paise)} × {hoursLabel(price.duration_minutes)}
                </dt>
                <dd>{formatInrPaise(price.base_before_busy_paise ?? price.base_paise)}</dd>
              </div>
              {busyHourText(price) ? (
                // Busy-hour pricing (server-applied): shown as its own line so the rows add up to the total.
                <div data-testid="busy-line">
                  <dt>Busy-hour price ({busyHourText(price)})</dt>
                  <dd>{price.base_paise < (price.base_before_busy_paise ?? price.base_paise) ? "−" : ""}{formatInrPaise(Math.abs(price.base_paise - (price.base_before_busy_paise ?? price.base_paise)))}</dd>
                </div>
              ) : null}
              <div>
                <dt>Platform fee</dt>
                <dd>{formatInrPaise(price.service_fee_paise)}</dd>
              </div>
              <div>
                <dt>Taxes</dt>
                <dd>Not configured</dd>
              </div>
              <div className="total-row">
                <dt>Total to pay</dt>
                <dd className="price" data-testid="quote-total">
                  {formatInrPaise(price.total_paise)}
                </dd>
              </div>
            </dl>
            <p className="field-hint">No tax rate is approved yet. Refreshments are optional and paid at the venue.</p>
          </Card>

          <details className="card book-card book-rules">
            <summary>Rules you are accepting</summary>
            <ul>
              <li>
                Outside food: <strong>{FOOD_RULE_LABEL[policy.byo_food]}</strong>. {policy.byo_details}
              </li>
              <li>
                Outside delivery: <strong>{FOOD_RULE_LABEL[policy.outside_delivery]}</strong>. Buying food from the venue is optional.
              </li>
              <li>{policy.house_rules}</li>
              <li>
                Cancellation: full refund if you cancel at least {policy.cancel_cutoff_minutes / 60} hours before the start; no refund after that.
                Arrive within {policy.grace_minutes} minutes of the start; your end time does not move.
              </li>
              <li>The table is cleaned for {policy.buffer_minutes} minutes after your booking.</li>
            </ul>
            <p className="field-hint">
              Quote valid until {formatVenueTime(quote.expires_at, quote.venue_timezone)} IST. Rules version {policy.policy_version} (proposed, not yet
              owner-approved).
            </p>
          </details>

          <label className="check-row">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} data-testid="accept-rules" />
            <span>I accept the venue rules and the cancellation terms.</span>
          </label>
          {quoteExpired ? (
            <Button variant="secondary" type="button" onClick={() => void loadQuote()}>
              Quote expired · get a fresh quote
            </Button>
          ) : (
            <Button type="button" disabled={!accepted || holding} aria-busy={holding} onClick={() => void hold()}
              data-testid="hold-table">
              {holding ? "Holding…" : `Reserve ${props.tableLabel} & continue`}
            </Button>
          )}
          <p className="field-hint">
            Not charged yet. We check the table again, then hold it for {policy.hold_minutes} minutes while you pay.
          </p>
        </>
      ) : null}
      <ButtonLink variant="secondary" href={`/venues/${props.slug}`}>
        Back to venue details
      </ButtonLink>
    </>
  );
}
