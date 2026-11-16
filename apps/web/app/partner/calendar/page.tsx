import { asUser, getDb, partnerCalendar } from "@simply-sit/db";
import { formatVenueTime, istInstant, venueLocalDate } from "../../../lib/format";
import { PartnerNav, partnerContext } from "../../../lib/partner-page";
import type { CalendarData } from "../../../lib/partner-types";
import { PortalBlocked } from "../../../lib/portal-page";

export const dynamic = "force-dynamic";

const STATUS_TEXT: Record<string, string> = {
  HOLD: "held (unpaid)", PENDING_PAYMENT: "held (paying)", CONFIRMED: "confirmed", CHECKED_IN: "checked in", COMPLETED: "completed",
  NO_SHOW: "no-show"
};

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// P05 - one venue-local day per table: bookings and holds, blackouts and readiness. Assigned staff; no prices or
// customer identifiers. An empty day still shows tables and their state.
export default async function PartnerCalendarPage({ searchParams }: { searchParams: Promise<{ venue?: string; date?: string }> }) {
  const sp = await searchParams;
  const ctx = await partnerContext("/partner/calendar", sp.venue);
  if (ctx.state === "blocked") return <PortalBlocked gate={ctx.gate} />;
  if (ctx.state !== "ok") return null;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : venueLocalDate();
  const from = istInstant(date, "00:00");
  const to = istInstant(shiftDate(date, 1), "00:00");
  const data = (await asUser(getDb(), ctx.gate.identity.claims, (tx) => partnerCalendar(tx, ctx.current.venue_id, from, to))) as CalendarData;
  const venueParam = `venue=${ctx.current.venue_id}`;

  return (
    <main>
      <h1>Calendar</h1>
      <PartnerNav current={ctx.current} memberships={ctx.memberships} active="/partner/calendar" />
      <nav aria-label="Day" className="tabs">
        <a href={`/partner/calendar?${venueParam}&date=${shiftDate(date, -1)}`}>Previous day</a>
        <strong>{new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))}</strong>
        <a href={`/partner/calendar?${venueParam}&date=${shiftDate(date, 1)}`}>Next day</a>
      </nav>
      {data.resources.length === 0 ? <p className="notice">No tables yet. Managers can add them under Inventory.</p> : null}
      {data.resources.map((r) => {
        const bookings = data.bookings.filter((b) => b.resource_id === r.id);
        const closures = data.closures.filter((c) => c.resource_id === r.id);
        return (
          <section key={r.id} className="card" style={{ marginBottom: 12 }} aria-labelledby={`r-${r.id}`} data-testid={`calendar-${r.label}`}>
            <h2 id={`r-${r.id}`}>
              {r.label} <span className="badge">{r.status === "ACTIVE" ? r.operational_state.toLowerCase().replace("_", " ") : r.status.toLowerCase()}</span>
            </h2>
            {bookings.length === 0 && closures.length === 0 ? <p className="food-note">Free all day.</p> : null}
            <ul>
              {closures.map((c) => (
                <li key={c.id}>
                  {formatVenueTime(c.starts_at)} - {formatVenueTime(c.ends_at)} IST · <strong>Blocked</strong> ({c.reason})
                </li>
              ))}
              {bookings.map((b) => (
                <li key={b.booking_id}>
                  {formatVenueTime(b.start_at)} - {formatVenueTime(b.end_at)} IST · <a href={`/partner/bookings/${b.booking_id}`}>{b.public_ref}</a> · party of{" "}
                  {b.party_size} · {STATUS_TEXT[b.status] ?? b.status.toLowerCase()}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
