import { notFound } from "next/navigation";
import type { VenueAvailability, VenueDetail } from "@simply-sit/contracts";
import { asAnon, getDb, serviceStatus, venueDayAvailability, venueDetail, venueIdBySlug, venuePhotos, venueReviews } from "@simply-sit/db";
import { FOOD_RULE_LABEL, formatInrPaise, formatVenueTime, istInstant, venueLocalDate } from "../../../lib/format";
import { tagLabel } from "../../../lib/labels";
import { WEEKDAYS } from "../../../lib/venues";
import { ArrowLeft, MapPin } from "lucide-react";
import { ImageGallery } from "../../../components/ui";

export const dynamic = "force-dynamic";

type Search = Promise<{ date?: string; time?: string; duration?: string; party?: string }>;

// "2026-11-12" -> "Today · Thu 12 Nov". The option value stays the ISO date.
const dateLabel = (iso: string, today: string) => {
  const text = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  return iso === today ? `Today · ${text}` : text;
};

const durationLabel = (m: number) => (m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`);

// Start times listed per table at once. A fine-grained venue (5-minute grid, long hours, many tables) would otherwise
// render well over a thousand links: slow to serve and hard to move through with a keyboard or screen reader.
const STARTS_SHOWN = 12;
const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

// C04 - published listing with approved photos, food/delivery/house rules, tables, hours and live (advisory) start times.
export default async function VenuePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Search }) {
  const { id: slug } = await params;
  const sp = await searchParams;
  const db = getDb();
  const venueId = /^[a-z0-9-]{1,80}$/.test(slug) ? await asAnon(db, (tx) => venueIdBySlug(tx, slug)) : null;
  if (!venueId) notFound();
  const venue = (await asAnon(db, (tx) => venueDetail(tx, venueId))) as VenueDetail | null;
  if (!venue) notFound();
  const [photos, reviews, status] = await asAnon(db, async (tx) =>
    [await venuePhotos(tx, venueId), await venueReviews(tx, venueId), await serviceStatus(tx)] as const);
  const policy = venue.policy;

  const today = venueLocalDate();
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date >= today ? sp.date : today;
  const durations: number[] = [];
  for (let m = policy.minimum_minutes; m <= policy.maximum_minutes; m += policy.increment_minutes) durations.push(m);
  const duration = durations.includes(Number(sp.duration)) ? Number(sp.duration) : policy.minimum_minutes;
  const maxParty = Math.max(...venue.tables.map((t) => t.capacity), 1);
  const party = Math.min(Math.max(Number(sp.party) || 2, 1), 50);
  const from = sp.time && HOURS.includes(sp.time) ? sp.time : "00:00";
  const fromInstant = Date.parse(istInstant(date, from));

  let availability: VenueAvailability | null = null;
  let availabilityError = false;
  if (status.bookings_open) {
    try {
      availability = (await asAnon(db, (tx) => venueDayAvailability(tx, venueId, date, duration, party))) as VenueAvailability;
    } catch {
      availabilityError = true;
    }
  }
  const dates = Array.from({ length: 14 }, (_, i) => venueLocalDate(330, Date.now() + i * 86_400_000));

  return (
    <main className="venue-page">
      <p className="back-row">
        <a className="back-link" href="/venues">
          <ArrowLeft size={16} aria-hidden="true" />
          Back to search
        </a>
      </p>
      <header className="venue-header">
        <p className="eyebrow">{tagLabel(venue.category_code)}</p>
        <h1>{venue.name}</h1>
        <p className="lede">
          <MapPin size={15} aria-hidden="true" />
          {tagLabel(venue.category_code)} · {venue.locality} · {venue.address}
        </p>
        {venue.is_synthetic ? (
          <p className="venue-flag">
            <span className="badge">Synthetic demo venue - fictional prices and rules</span>
          </p>
        ) : null}
        <p className="venue-description">{venue.description}</p>
      </header>
      <ImageGallery photos={photos} />

      <div className="venue-layout">
        <div className="venue-aside">
      <section className="card time-card" aria-labelledby="book-heading">
        <h2 id="book-heading">Choose a time</h2>
        <form method="get" className="time-form">
          <div>
            <label htmlFor="date">Date</label>
            <select id="date" name="date" className="input" defaultValue={date}>
              {dates.map((d) => (
                <option key={d} value={d}>
                  {dateLabel(d, today)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="duration">Duration</label>
            <select id="duration" name="duration" className="input" defaultValue={String(duration)}>
              {durations.map((m) => (
                <option key={m} value={m}>
                  {durationLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="time">From</label>
            <select id="time" name="time" className="input" defaultValue={from}>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h === "00:00" ? "Earliest" : h}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="party">People</label>
            <select id="party" name="party" className="input" defaultValue={String(party)}>
              {Array.from({ length: Math.max(maxParty, party) }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="time-form-action">
            <button className="button secondary block" type="submit">
              Show times
            </button>
          </div>
        </form>

        {status.bookings_open ? null : (
          <p className="notice" role="status" data-testid="bookings-paused">
            New bookings are paused for now, so no times are shown. Existing bookings are not affected. Please check back later.
          </p>
        )}
        {availabilityError ? (
          <p className="status-error" role="alert">
            Times could not be loaded. Refresh to try again.
          </p>
        ) : null}
        {availability && availability.tables.length === 0 ? (
          <p className="notice" role="status">
            No table here seats {party}. The largest table seats {maxParty}.
          </p>
        ) : null}
        {availability?.tables.map((table) => {
          const later = table.starts.filter((start) => Date.parse(start) >= fromInstant);
          const shown = later.slice(0, STARTS_SHOWN);
          return (
          <div key={table.resource_id} className="table-slots" data-testid="table-slots">
            <h3>
              {table.label} · seats up to {table.capacity}
              {"total_paise" in table.price ? ` · ${formatInrPaise(table.price.total_paise)} for ${durationLabel(duration)}` : ""}
            </h3>
            {shown.length === 0 ? (
              <p className="food-note">
                No free start times on {date}{from === "00:00" ? "" : ` from ${from}`} for {durationLabel(duration)}.
              </p>
            ) : (
              <ul className="slot-list" aria-label={`Start times for ${table.label}`}>
                {shown.map((start) => (
                  <li key={start}>
                    <a
                      className="slot"
                      href={`/venues/${venue.slug}/book?resource=${table.resource_id}&start=${encodeURIComponent(start)}&duration=${duration}&party=${party}`}
                    >
                      {formatVenueTime(start, venue.timezone)}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {later.length > shown.length ? (
              <p className="food-note">
                Showing the first {STARTS_SHOWN} free times{from === "00:00" ? "" : ` from ${from}`}. Choose a later &quot;From&quot; time to see more.
              </p>
            ) : null}
          </div>
          );
        })}
        <p className="food-note">Times are shown in IST and are checked again when you hold the table.</p>
      </section>
        </div>
        <div className="venue-main">
      <section className="card" aria-labelledby="food-heading">
        <h2 id="food-heading">Food and house rules</h2>
        <p>
          Outside food: <strong>{FOOD_RULE_LABEL[policy.byo_food]}</strong>. {policy.byo_details}
        </p>
        <p>
          Outside delivery: <strong>{FOOD_RULE_LABEL[policy.outside_delivery]}</strong>. Buying food from the venue is optional.
        </p>
        <p className="food-note">{policy.house_rules}</p>
        <p className="food-note">On arrival: {policy.handover_instructions}</p>
        <p className="food-note">
          Cancellation (proposed policy, not yet approved): full refund up to {policy.cancel_cutoff_minutes / 60} hours before the start;
          no refund after that. Bookings run {durationLabel(policy.minimum_minutes)} to {durationLabel(policy.maximum_minutes)} in{" "}
          {policy.increment_minutes}-minute steps, with a {policy.buffer_minutes}-minute cleaning buffer after each booking.
        </p>
      </section>

      {venue.amenities.length > 0 || venue.environment.length > 0 ? (
        <section className="card" aria-labelledby="amenities-heading">
          <h2 id="amenities-heading">Amenities and atmosphere</h2>
          <ul className="chips">
            {venue.amenities.map((a) => (
              <li key={a.code} className="chip">
                {tagLabel(a.code)}
                {a.verified ? "" : " (unverified)"}
              </li>
            ))}
            {venue.environment.map((e) => (
              <li key={e} className="chip">
                {tagLabel(e)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {reviews.count > 0 ? (
        <section className="card" aria-labelledby="reviews-heading" data-testid="venue-reviews">
          <h2 id="reviews-heading">
            Reviews: {reviews.average} of 5 ({reviews.count})
          </h2>
          <ul className="review-list">
            {reviews.recent.map((r, i) => (
              <li key={i}>
                {r.rating} of 5{r.body ? ` - ${r.body}` : ""} <span className="food-note">({r.month})</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card" aria-labelledby="hours-heading">
        <h2 id="hours-heading">Bookable hours ({venue.timezone})</h2>
        <dl className="hours-list">
          {venue.hours.map((period) => (
            <div key={`${period.weekday}-${period.opens}`}>
              <dt>{WEEKDAYS[period.weekday]}</dt>
              <dd>
                {period.opens}-{period.closes}
                {period.closes_next_day ? " (next day)" : ""}
              </dd>
            </div>
          ))}
        </dl>
        <p className="food-note">
          <a href={`https://www.openstreetmap.org/?mlat=${venue.lat}&mlon=${venue.lng}#map=17/${venue.lat}/${venue.lng}`} rel="noreferrer">
            Directions (OpenStreetMap)
          </a>{" "}
          - fictional demo coordinates.
        </p>
      </section>
        </div>
      </div>
    </main>
  );
}
