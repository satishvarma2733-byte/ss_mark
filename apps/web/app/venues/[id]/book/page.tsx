import { notFound, redirect } from "next/navigation";
import { Info } from "lucide-react";
import type { VenueAvailability, VenueDetail } from "@simply-sit/contracts";
import { asAnon, getDb, serviceStatus, venueDayAvailability, venueDetail, venueIdBySlug, venuePhotos } from "@simply-sit/db";
import { resolveIdentity } from "../../../../lib/auth/identity";
import { loadMe } from "../../../../lib/me";
import { formatInrPaise, formatVenueTime, venueLocalDate } from "../../../../lib/format";
import { VenuePhoto } from "../../../../components/venue-photo";
import { BookFlow } from "./book-flow";
import { Card } from "../../../../components/ui";

export const dynamic = "force-dynamic";

type Search = Promise<{ resource?: string; start?: string; duration?: string; party?: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const durationLabel = (m: number) =>
  m % 60 === 0 ? `${m / 60} ${m === 60 ? "hour" : "hours"}` : `${Math.floor(m / 60)} h ${m % 60} min`;

const longDate = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

type TableChoice = { resource_id: string; label: string; capacity: number; hourly_paise: number | null; state: "available" | "unavailable" | "too_small" };

// C05 - Figma "E · Customer web · Select table and time": the exact table for the chosen interval, the quote, explicit
// rules acceptance, then an atomic hold. Sign-in is required before any quote. Table states are advisory and are
// checked again by the hold.
export default async function BookPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Search }) {
  const { id: slug } = await params;
  const sp = await searchParams;
  if (!/^[a-z0-9-]{1,80}$/.test(slug) || !sp.resource || !UUID.test(sp.resource) || !sp.start || Number.isNaN(Date.parse(sp.start))) notFound();
  const duration = Number(sp.duration);
  const party = Number(sp.party);
  if (!Number.isInteger(duration) || duration < 15 || duration > 1440 || !Number.isInteger(party) || party < 1 || party > 50) notFound();

  const identity = await resolveIdentity();
  if (identity.kind !== "user") {
    const back = `/venues/${slug}/book?resource=${sp.resource}&start=${encodeURIComponent(sp.start)}&duration=${duration}&party=${party}`;
    redirect(`/sign-in?redirect_path=${encodeURIComponent(back)}`);
  }
  const db = getDb();
  const [venueId, status] = await asAnon(db, async (tx) => [await venueIdBySlug(tx, slug), await serviceStatus(tx)] as const);
  if (!venueId) notFound();
  const [venue, photos] = await asAnon(db, async (tx) =>
    [(await venueDetail(tx, venueId)) as VenueDetail | null, await venuePhotos(tx, venueId)] as const);
  if (!venue) notFound();
  const photo = photos[0] ?? null;
  const me = await loadMe(identity.claims);

  const startAt = new Date(sp.start).toISOString();
  const startMs = Date.parse(startAt);
  const endAt = new Date(startMs + duration * 60_000).toISOString();
  const date = venueLocalDate(330, startMs);
  let availability: VenueAvailability | null = null;
  if (status.bookings_open) {
    try {
      availability = (await asAnon(db, (tx) => venueDayAvailability(tx, venueId, date, duration, party))) as VenueAvailability;
    } catch {
      availability = null;
    }
  }
  const freeNow = new Set(
    (availability?.tables ?? []).filter((t) => t.starts.some((s) => Date.parse(s) === startMs)).map((t) => t.resource_id)
  );
  const tables: TableChoice[] = venue.tables.map((t) => ({
    ...t,
    state: t.capacity < party ? "too_small" : freeNow.has(t.resource_id) ? "available" : "unavailable"
  }));
  const selected = tables.find((t) => t.resource_id === sp.resource);
  if (!selected) notFound();
  const seats = venue.tables.reduce((sum, t) => sum + t.capacity, 0);
  const policy = venue.policy;
  const tz = venue.timezone;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const hoursToday = venue.hours.filter((h) => h.weekday === weekday);
  const durations: number[] = [];
  for (let m = policy.minimum_minutes; m <= policy.maximum_minutes; m += policy.increment_minutes) durations.push(m);
  const timeRange = `${formatVenueTime(startAt, tz)}–${formatVenueTime(endAt, tz)}`;
  const bufferEnd = new Date(Date.parse(endAt) + policy.buffer_minutes * 60_000).toISOString();
  const href = (resource: string, minutes = duration) =>
    `/venues/${slug}/book?resource=${resource}&start=${encodeURIComponent(startAt)}&duration=${minutes}&party=${party}`;

  const stateText = (t: TableChoice) => {
    const chosen = t.resource_id === selected.resource_id ? "Selected · " : "";
    if (t.state === "too_small") return `${chosen}Too small for ${party} guests`;
    return `${chosen}${t.state === "available" ? "Available" : "Unavailable for this time"}`;
  };

  return (
    <main className="customer-page">
      <p className="page-crumbs">SIMPLY SIT / {venue.name} / Choose a table</p>
      <div className="customer-page-intro">
        <h1>Choose your table.</h1>
        <p className="lede">{venue.name} · Step 1 of 3 · Not yet held or confirmed</p>
      </div>
      {me.terms_required ? (
        <div className="notice warm" role="alert">
          <Info size={19} aria-hidden="true" />
          <div>
            <strong>Accept the current terms first</strong>
            <p>
              Accept the terms on your <a href={`/account?redirect_path=${encodeURIComponent(`/venues/${slug}`)}`}>account page</a> before holding a
              table.
            </p>
          </div>
        </div>
      ) : null}
      <div className="book-layout">
        <div className="book-main">
          <dl className="book-fields">
            <div>
              <dt className="field-label">Date</dt>
              <dd className="input">{longDate(startAt, tz)}</dd>
            </div>
            <div>
              <dt className="field-label">Time · IST</dt>
              <dd className="input">{timeRange}</dd>
            </div>
            <div>
              <dt className="field-label">Party</dt>
              <dd className="input">
                {party} {party === 1 ? "guest" : "guests"}
              </dd>
            </div>
          </dl>

          <Card className="book-card" aria-labelledby="tables-heading">
            <h2 id="tables-heading">Choose an exact table</h2>
            <VenuePhoto
              mediaId={photo?.id ?? null}
              alt={photo?.alt_text ?? ""}
              className="book-photo"
              width={1184}
              height={400}
            />
            <p className="book-note">
              {venue.tables.length} {venue.tables.length === 1 ? "table" : "tables"} / {seats} seats
            </p>
            <ul className="table-choices" aria-label="Tables for this time">
              {tables.map((t) => {
                const isSelected = t.resource_id === selected.resource_id;
                const body = (
                  <>
                    <span className="table-choice-name">
                      {t.label} · {t.capacity} {t.capacity === 1 ? "seat" : "seats"}
                    </span>
                    <span className="table-choice-price">{t.hourly_paise === null ? "Price on request" : `${formatInrPaise(t.hourly_paise)} / table / hr`}</span>
                    <span className="table-choice-state">{stateText(t)}</span>
                  </>
                );
                return (
                  <li key={t.resource_id}>
                    {t.state === "available" && !isSelected ? (
                      <a className="table-choice" href={href(t.resource_id)}>
                        {body}
                      </a>
                    ) : (
                      <span className={`table-choice${isSelected ? " selected" : ""}`} aria-current={isSelected ? "true" : undefined}>
                        {body}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="field-hint">
              Statuses are for the selected interval. No automatic table substitution. Your table is checked again before a hold is created.
            </p>
          </Card>

          <Card className="book-card" aria-labelledby="time-heading">
            <h2 id="time-heading">Selected time</h2>
            <ul className="choice-pills" aria-label="Selected booking">
              <li className="choice-pill selected">{timeRange}</li>
              <li className="choice-pill">{durationLabel(duration)}</li>
              <li className="choice-pill">
                {party} {party === 1 ? "guest" : "guests"}
              </li>
            </ul>
            <dl className="detail-rows">
              <div>
                <dt>Cleaning protected</dt>
                <dd>
                  {formatVenueTime(endAt, tz)}–{formatVenueTime(bufferEnd, tz)}
                </dd>
              </div>
            </dl>
            <p className="book-note">
              {hoursToday.length > 0 ? `Open ${hoursToday.map((h) => `${h.opens}–${h.closes}`).join(", ")}` : "Closed this day"} · Minimum{" "}
              {durationLabel(policy.minimum_minutes)} · {policy.lead_minutes}-minute lead time.
            </p>
          </Card>

          <div className="notice info">
            <Info size={19} aria-hidden="true" />
            <div>
              <strong>Table-only reservations</strong>
              <p>
                No compulsory refreshment order. Outside food:{" "}
                {policy.byo_food === "ALLOWED" ? "allowed" : policy.byo_food === "RESTRICTED" ? "restricted" : "not allowed"}. Outside deliveries:{" "}
                {policy.outside_delivery === "ALLOWED" ? "allowed" : policy.outside_delivery === "RESTRICTED" ? "restricted" : "not allowed"} at this
                venue.
              </p>
            </div>
          </div>
        </div>

        <div className="book-side">
          {status.bookings_open ? (
            <BookFlow
              venueId={venueId}
              slug={slug}
              resourceId={selected.resource_id}
              tableLabel={selected.label}
              capacity={selected.capacity}
              tableFree={selected.state === "available"}
              startAt={startAt}
              durationMinutes={duration}
              durations={durations.map((m) => ({ minutes: m, label: durationLabel(m), href: href(selected.resource_id, m) }))}
              partySize={party}
              whenLabel={`${new Intl.DateTimeFormat("en-IN", { timeZone: tz, day: "numeric", month: "short" }).format(new Date(startAt))} · ${timeRange} IST`}
            />
          ) : (
            <p className="notice" role="status" data-testid="bookings-paused">
              New bookings are paused for now. Existing bookings are not affected. Please check back later.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
