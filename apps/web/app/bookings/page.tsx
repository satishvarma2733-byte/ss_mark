import { redirect } from "next/navigation";
import { Info } from "lucide-react";
import { refundStatusText, type BookingSummary } from "@simply-sit/contracts";
import { asUser, customerBookings, getDb } from "@simply-sit/db";
import { resolveIdentity } from "../../lib/auth/identity";
import { formatInrPaise, formatVenueTime } from "../../lib/format";
import { bookingStatusLabel } from "../../lib/labels";
import { longDate } from "../../components/booking-parts";
import { Button, ButtonLink, Card, StatusPill } from "../../components/ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "all", label: "All bookings" },
  { key: "upcoming", label: "Upcoming" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" }
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

const UPCOMING = new Set(["HOLD", "PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN"]);
const ENDED = new Set(["CANCELLED", "EXPIRED", "NO_SHOW"]);

const monthKey = (iso: string) => iso.slice(0, 7);
const monthLabel = (key: string) =>
  new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`));

function group(b: BookingSummary): "upcoming" | "completed" | "cancelled" {
  if (ENDED.has(b.status) || ((b.status === "HOLD" || b.status === "PENDING_PAYMENT") && !b.hold_active)) return "cancelled";
  if (b.status === "COMPLETED") return "completed";
  return UPCOMING.has(b.status) && Date.parse(b.end_at) > Date.parse(b.server_now) ? "upcoming" : "completed";
}

const GROUP_LABEL = { upcoming: "Upcoming", completed: "Completed", cancelled: "Cancelled" } as const;

// C09 - Figma "E · Customer web · My bookings and receipts": own bookings with separate booking and refund states,
// filter chips, and a search/period filter. Lists come from the caller's own rows only (RLS-scoped query).
export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string; month?: string }> }) {
  const sp = await searchParams;
  const filter: FilterKey = FILTERS.some((f) => f.key === sp.filter) ? (sp.filter as FilterKey) : "all";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : "";
  const identity = await resolveIdentity();
  if (identity.kind !== "user") redirect(`/sign-in?redirect_path=${encodeURIComponent("/bookings")}`);
  const page = await asUser(getDb(), identity.claims, (tx) => customerBookings(tx, "all", 0, 50));
  const all = page.bookings as unknown as BookingSummary[];
  const months = [...new Set(all.map((b) => monthKey(b.start_at)))].sort().reverse();
  const needle = q.toLowerCase();
  const bookings = all.filter(
    (b) =>
      (filter === "all" || group(b) === filter) &&
      (!month || monthKey(b.start_at) === month) &&
      (!needle || b.venue.name.toLowerCase().includes(needle) || b.public_ref.toLowerCase().includes(needle))
  );
  const filterHref = (key: FilterKey) => {
    const params = new URLSearchParams();
    if (key !== "all") params.set("filter", key);
    if (q) params.set("q", q);
    if (month) params.set("month", month);
    const s = params.toString();
    return s ? `/bookings?${s}` : "/bookings";
  };

  return (
    <main className="customer-page">
      <p className="page-crumbs">SIMPLY SIT / Your account / My bookings</p>
      <div className="customer-page-intro">
        <h1>Your good hours, in one place.</h1>
        <p className="lede">Browse upcoming, completed and cancelled stays.</p>
      </div>
      <div className="book-layout bookings-layout">
        <div className="book-main">
          <nav aria-label="Booking filters">
            <ul className="choice-pills">
              {FILTERS.map((f) => (
                <li key={f.key}>
                  <a className={`choice-pill${f.key === filter ? " selected" : ""}`} href={filterHref(f.key)} aria-current={f.key === filter ? "page" : undefined}>
                    {f.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          {bookings.length === 0 ? (
            <div className="notice info" data-testid="bookings-empty">
              <Info size={20} aria-hidden="true" />
              <div>
                <strong>{all.length === 0 ? "No bookings yet" : "No bookings match these filters"}</strong>
                <p>{all.length === 0 ? "Your reserved tables, receipts and refunds will appear here." : "Try another filter or clear the search."}</p>
                <a className="text-link" href={all.length === 0 ? "/" : "/bookings"}>
                  {all.length === 0 ? "Find a space →" : "Clear filters →"}
                </a>
              </div>
            </div>
          ) : (
            <ul className="booking-cards">
              {bookings.map((b) => {
                const kind = group(b);
                const tz = b.venue.timezone;
                const holding = (b.status === "HOLD" || b.status === "PENDING_PAYMENT") && b.hold_active;
                const href = holding ? `/checkout/${b.booking_id}` : `/bookings/${b.booking_id}`;
                const refund = b.refunds.at(-1);
                const tone = kind === "cancelled" ? "danger" : holding ? "warning" : "";
                const cancellable = b.status === "CONFIRMED" && Date.parse(b.server_now) < Date.parse(b.start_at);
                return (
                  <li key={b.booking_id}>
                    <Card className="book-card" as="article" data-testid="booking-card" aria-labelledby={`b-${b.booking_id}`}>
                      <h2 id={`b-${b.booking_id}`}>
                        {GROUP_LABEL[kind]} · {b.venue.name}
                      </h2>
                      <div className="pill-row">
                        <span className={`status-pill${tone ? ` ${tone}` : ""}`} data-testid="booking-status">
                          {tone ? null : <img src="/design/status-dot-available.svg" alt="" width={5} height={5} />}
                          {bookingStatusLabel(b.status, b.hold_active)}
                          {b.status === "COMPLETED" && !b.review ? " · Eligible for review" : ""}
                        </span>
                        {b.venue.is_synthetic ? <StatusPill tone="neutral">Synthetic demo</StatusPill> : null}
                      </div>
                      <p className="book-when">
                        {b.public_ref} · {b.table.label} · {b.party_size} {b.party_size === 1 ? "guest" : "guests"}
                      </p>
                      <dl className="detail-rows">
                        <div>
                          <dt>{longDate(b.start_at, tz)} · IST</dt>
                          <dd>
                            {formatVenueTime(b.start_at, tz)}–{formatVenueTime(b.end_at, tz)}
                          </dd>
                        </div>
                        {kind === "cancelled" && b.cancelled_at ? (
                          <div>
                            <dt>Cancelled at</dt>
                            <dd>{formatVenueTime(b.cancelled_at, tz)} IST</dd>
                          </div>
                        ) : null}
                        {refund ? (
                          <div>
                            <dt>Refund · {refundStatusText(refund.status)}</dt>
                            <dd>{formatInrPaise(refund.amount_paise)}</dd>
                          </div>
                        ) : (
                          <div>
                            <dt>{kind === "cancelled" || holding ? "Total" : "Paid"}</dt>
                            <dd>{formatInrPaise(b.total_paise)}</dd>
                          </div>
                        )}
                      </dl>
                      <div className="action-row">
                        {holding ? (
                          <ButtonLink href={href}>
                            Continue to payment
                          </ButtonLink>
                        ) : kind === "upcoming" ? (
                          <>
                            <ButtonLink href={href}>
                              Open booking pass
                            </ButtonLink>
                            <ButtonLink variant="secondary" href={href}>
                              Receipt
                            </ButtonLink>
                            {cancellable ? (
                              <ButtonLink variant="secondary" href={`/bookings/${b.booking_id}/cancel`}>
                                Manage booking
                              </ButtonLink>
                            ) : null}
                          </>
                        ) : kind === "completed" ? (
                          <>
                            {b.status === "COMPLETED" ? (
                              <ButtonLink href={`/bookings/${b.booking_id}/review`}>
                                {b.review ? "View review" : "Write a review"}
                              </ButtonLink>
                            ) : null}
                            <a className={`button${b.status === "COMPLETED" ? " secondary" : ""}`} href={href}>
                              Receipt
                            </a>
                          </>
                        ) : (
                          <>
                            <ButtonLink variant="secondary" href={href}>
                              {refund ? "Track refund" : "View booking"}
                            </ButtonLink>
                          </>
                        )}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <aside className="book-side bookings-side" aria-label="Find and help">
          <form className="card book-card" action="/bookings" method="get" aria-labelledby="find-heading">
            <h2 id="find-heading">Find a booking</h2>
            {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
            <div className="field">
              <label className="field-label" htmlFor="q">
                Search
              </label>
              <input id="q" name="q" className="input" placeholder="Venue or booking ID" defaultValue={q} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="month">
                Period
              </label>
              <select id="month" name="month" className="input" defaultValue={month}>
                <option value="">Any month</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="secondary" type="submit">
              Apply filters
            </Button>
          </form>
          <div className="notice info">
            <Info size={20} aria-hidden="true" />
            <div>
              <strong>Separate states, clear records</strong>
              <p>A booking pass, a completed stay and a refund status have different purposes. A pending refund is not money credited yet.</p>
            </div>
          </div>
          <Card className="book-card" aria-labelledby="hand-heading">
            <h2 id="hand-heading">Need a hand?</h2>
            <p className="book-when">Open a booking to raise a linked support case. Your booking ID helps us investigate without asking for payment details.</p>
            <ButtonLink variant="secondary" href="/help">
              Open support centre
            </ButtonLink>
          </Card>
        </aside>
      </div>
    </main>
  );
}
