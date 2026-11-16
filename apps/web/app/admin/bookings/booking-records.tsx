// Shared parts of Figma "Admin · Booking and settlement operations": the search bar, the matching-records column and
// the booking status pill. Server components; searching by a customer's email stays exact and audited.
import { CalendarDays, Mail, Search, ShieldCheck } from "lucide-react";
import { bookingSearchQuerySchema } from "@simply-sit/contracts";
import { adminBookingSearch, asUser, getDb } from "@simply-sit/db";
import type { VerifiedClaims } from "@simply-sit/db";
import { formatInrPaise, formatVenueDateTime, formatVenueTime, venueLocalDate } from "../../../lib/format";

export type BookingRow = { booking_id: string; public_ref: string; status: string; venue_name: string; start_at: string; end_at?: string; total_paise: number };
export type BookingQuery = { ref?: string; venue_id?: string; date?: string; email?: string };

export function bookingPill(status: string): { text: string; tone: string } {
  if (status === "CONFIRMED") return { text: "Confirmed", tone: "" };
  if (status === "CHECKED_IN") return { text: "Checked in", tone: "" };
  if (status === "COMPLETED") return { text: "Completed", tone: " neutral" };
  if (status === "HOLD" || status === "PENDING_PAYMENT") return { text: status === "HOLD" ? "Held (unpaid)" : "Payment pending", tone: " warm" };
  if (status === "CANCELLED") return { text: "Cancelled", tone: " danger" };
  if (status === "NO_SHOW") return { text: "No-show", tone: " warm" };
  const text = status.replace(/_/g, " ").toLowerCase();
  return { text: text.charAt(0).toUpperCase() + text.slice(1), tone: " neutral" };
}

export function bookingQuery(sp: Record<string, string | undefined>): BookingQuery {
  return Object.fromEntries(Object.entries({ ref: sp.ref, venue_id: sp.venue_id, date: sp.date, email: sp.email }).filter(([, v]) => v)) as BookingQuery;
}

export function queryString(q: BookingQuery) {
  const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
  const s = params.toString();
  return s ? `?${s}` : "";
}

// Runs the bounded admin search when any field is filled. Returns null when nothing was searched.
export async function searchBookings(claims: VerifiedClaims, q: BookingQuery) {
  if (Object.keys(q).length === 0) return null;
  const parsed = bookingSearchQuerySchema.safeParse(q);
  if (!parsed.success) return { valid: false as const, rows: [] as BookingRow[] };
  const rows = (await asUser(getDb(), claims, (tx) => adminBookingSearch(tx, parsed.data))) as BookingRow[];
  return { valid: true as const, rows };
}

export function BookingSearchForm({ q }: { q: BookingQuery }) {
  return (
    <form className="ops-search" method="get" action="/admin/bookings" aria-label="Search bookings">
      {q.venue_id ? <input type="hidden" name="venue_id" value={q.venue_id} /> : null}
      <div className="field">
        <label className="field-label" htmlFor="search-ref">
          Booking reference
        </label>
        <div className="field-control compact">
          <Search size={17} aria-hidden="true" />
          <input id="search-ref" name="ref" defaultValue={q.ref ?? ""} placeholder="SS-..." data-testid="search-ref" />
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="search-date">
          Date (IST)
        </label>
        <div className="field-control compact">
          <CalendarDays size={17} aria-hidden="true" />
          <input id="search-date" type="date" name="date" defaultValue={q.date ?? ""} />
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="search-email">
          Customer email · exact, recorded
        </label>
        <div className="field-control compact">
          <Mail size={17} aria-hidden="true" />
          <input id="search-email" type="email" name="email" defaultValue={q.email ?? ""} placeholder="name@example.com" />
        </div>
      </div>
      <button className="button" type="submit" data-testid="search-submit">
        Search records
      </button>
    </form>
  );
}

export function BookingRecordList({
  result,
  q,
  selected
}: {
  result: Awaited<ReturnType<typeof searchBookings>>;
  q: BookingQuery;
  selected?: BookingRow;
}) {
  // Without a search, the detail page still lists the open booking so the column is never empty.
  const rows = result?.valid ? result.rows : selected ? [selected] : [];
  const qs = queryString(q);
  return (
    <aside className="submission-column" aria-labelledby="records-heading">
      <div className="section-heading stacked">
        <h2 id="records-heading">Matching records</h2>
        <p className="small">
          {result === null
            ? selected
              ? "Selected record · search to see others"
              : "Search by reference, date or a customer's exact email."
            : result.valid
              ? `${result.rows.length} ${result.rows.length === 1 ? "record" : "records"}`
              : "Check the search fields."}
        </p>
      </div>
      {result && !result.valid ? <p className="status-error">Check the search fields.</p> : null}
      {result?.valid && result.rows.length === 0 ? <p className="notice">No bookings found.</p> : null}
      {rows.length > 0 ? (
        <ul className="submission-list" data-testid="booking-results">
          {rows.map((r) => {
            const pill = bookingPill(r.status);
            const isSelected = r.booking_id === selected?.booking_id;
            return (
              <li key={r.booking_id}>
                <article className={isSelected ? "submission-card selected" : "submission-card"}>
                  <h3>
                    <a href={`/admin/bookings/${r.booking_id}${qs}`} aria-current={isSelected ? "page" : undefined}>
                      {r.public_ref}
                    </a>
                  </h3>
                  <p className="small">{r.venue_name}</p>
                  <p className="muted small">
                    {formatVenueDateTime(r.start_at)}
                    {r.end_at ? `–${formatVenueTime(r.end_at)}` : ""} IST
                  </p>
                  <span className={`status-pill${pill.tone}`}>{pill.text}</span>
                  <p className="record-total">
                    <span>Booking total</span>
                    <strong>{formatInrPaise(r.total_paise)}</strong>
                  </p>
                </article>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="notice info">
        <ShieldCheck size={18} aria-hidden="true" />
        <div>
          <strong>Sensitive data is masked</strong>
          <p>Arrival codes and payment secrets are never shown here. Opening a booking and searching by email are logged.</p>
        </div>
      </div>
    </aside>
  );
}

export function BookingOpsHeading() {
  const today = venueLocalDate();
  const label = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${today}T00:00:00Z`));
  return (
    <div className="page-heading">
      <div className="stacked-copy">
        <h1 className="title-sans">Resolve carefully. Reconcile completely.</h1>
        <p className="lede">Booking, payment, refund and settlement states remain separate · All times Asia/Kolkata.</p>
      </div>
      <a className="button secondary" href={`/admin/bookings?date=${today}`}>
        <CalendarDays size={18} aria-hidden="true" />
        Today · {label}
      </a>
    </div>
  );
}
