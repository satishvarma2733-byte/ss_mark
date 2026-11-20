"use client";

// Seat-map phase 4 - the web version of Figma "Customer · Choose seating area and table" (2063:220) and "Table details
// sheet" (2065:270). Areas with their from-price, start times (free starts of the area's tables on the chosen day), the
// published floor drawing coloured for that time, and a panel with the chosen table's photo, features, price and free
// times. "Hold" links to the existing /venues/{slug}/book page, which quotes and holds as before.
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { CloudSun, Home, Lock, Sun } from "lucide-react";
import { busyHourText, type SeatMap, type VenueAvailability, type VenueSeating } from "@simply-sit/contracts";
import { apiCall } from "../../../lib/client-api";
import { formatInrPaise, formatVenueTime } from "../../../lib/format";

type Zone = VenueSeating["zones"][number];
type Element = NonNullable<Zone["layout"]>["elements"][number];
type Seat = SeatMap["tables"][number];

const KIND_LABEL: Record<Zone["kind"], string> = { INDOOR: "Indoor", OUTDOOR: "Outdoor", ROOFTOP: "Rooftop", PRIVATE_ROOM: "Private room" };
const KIND_ICON = { INDOOR: Home, OUTDOOR: Sun, ROOFTOP: CloudSun, PRIVATE_ROOM: Lock } as const;
const FEATURE_LABEL: Record<string, string> = {
  WINDOW: "Window view", POWER_SOCKET: "Power socket", AIR_CONDITIONED: "Air-conditioned", SOFA_SEATING: "Sofa seating",
  STEP_FREE: "Step-free", QUIET: "Quiet corner", VIEW: "Nice view"
};
const STATE_WORD: Record<Seat["state"], string> = { FREE: "free", BOOKED: "booked", TOO_SMALL: "too small for your group", UNAVAILABLE: "not available then" };
// Table name on the drawing: without a generic prefix, and only its last word when the full name would not fit.
function fitLabel(label: string, width: number) {
  const short = label.replace(/^(Table|Desk|Long table|Courtyard)\s+/i, "");
  return short.length * 8.5 > width - 8 ? short.split(/\s+/).at(-1) ?? short : short;
}
const durationLabel = (m: number) => (m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`);

export function SeatMapPicker(props: {
  venueId: string;
  slug: string;
  timezone: string;
  seating: VenueSeating;
  availability: VenueAvailability;
  duration: number;
  party: number;
  fromInstant: number;
}) {
  const { seating, availability, duration, party, timezone } = props;
  const zones = seating.zones.filter((z) => z.layout);
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? null);
  const zone = zones.find((z) => z.id === zoneId) ?? zones[0]!;
  const tableIds = useMemo(() => new Set(zone.layout!.elements.filter((e) => e.resource_id).map((e) => e.resource_id!)), [zone]);
  const starts = useMemo(
    () => [...new Set(availability.tables.filter((t) => tableIds.has(t.resource_id)).flatMap((t) => t.starts))]
      .filter((s) => Date.parse(s) >= props.fromInstant).sort(),
    [availability, tableIds, props.fromInstant]
  );
  const [start, setStart] = useState<string | null>(null);
  const chosen = start && starts.includes(start) ? start : starts[0] ?? null;
  const [map, setMap] = useState<SeatMap | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setMap(null);
    setFailed(false);
    if (!chosen) return;
    const q = new URLSearchParams({ start_at: chosen, duration_minutes: String(duration), party_size: String(party) });
    void apiCall<SeatMap>("GET", `/api/v1/venues/${props.venueId}/seat-map?${q}`).then((r) => {
      if (!live) return;
      if (r.ok) setMap(r.data); else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [props.venueId, chosen, duration, party]);

  const seats = new Map((map?.tables ?? []).map((t) => [t.resource_id, t]));
  const free = (map?.tables ?? []).filter((t) => tableIds.has(t.resource_id) && t.state === "FREE").length;
  const pickedEl = picked ? zone.layout!.elements.find((e) => e.resource_id === picked) ?? null : null;

  return (
    <section className="card seat-map-card" aria-labelledby="seat-heading" data-testid="seat-map-picker">
      <div>
        <h2 id="seat-heading">Where would you like to sit?</h2>
        <p className="food-note">Each area has its own price. Pick an area, a start time and then a table on the floor.</p>
      </div>
      <div className="seat-zones" role="tablist" aria-label="Seating areas">
        {zones.map((z) => {
          const Icon = KIND_ICON[z.kind];
          const selected = z.id === zone.id;
          return (
            <button key={z.id} type="button" role="tab" aria-selected={selected} className="seat-zone" data-testid="seat-zone"
              onClick={() => { setZoneId(z.id); setPicked(null); }}>
              <Icon size={20} aria-hidden="true" />
              <strong>{z.name}</strong>
              <span>{KIND_LABEL[z.kind]} · {z.table_count} {z.table_count === 1 ? "table" : "tables"}</span>
              {z.from_hourly_paise !== null ? <span className="seat-zone-price">From {formatInrPaise(z.from_hourly_paise)}/hr</span> : null}
            </button>
          );
        })}
      </div>

      {starts.length === 0 ? (
        <p className="notice" role="status">
          No table in {zone.name} is free for {party} {party === 1 ? "guest" : "guests"} for {durationLabel(duration)} at these times. Try another date,
          length or area.
        </p>
      ) : (
        <fieldset className="seat-starts">
          <legend>Start time · IST</legend>
          <div className="choice-pills">
            {starts.slice(0, 24).map((s) => (
              <label key={s} className={`choice-pill${s === chosen ? " selected" : ""}`}>
                <input type="radio" name="seat-start" checked={s === chosen} onChange={() => setStart(s)} />
                {formatVenueTime(s, timezone)}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {chosen ? (
        <div className="seat-body">
          <div className="seat-floor-wrap">
            <p className="seat-summary" data-testid="seat-summary" aria-live="polite">
              <strong>{zone.name} · {KIND_LABEL[zone.kind]}</strong>{" "}
              {map ? `· ${formatVenueTime(chosen, timezone)}–${formatVenueTime(map.end_at, timezone)} · ${party} ${party === 1 ? "guest" : "guests"} · ${free} free` : "· checking tables…"}
            </p>
            <ul className="seat-legend" aria-label="Legend">
              <li><span className="sw free" />Free</li>
              <li><span className="sw pick" />Your pick</li>
              <li><span className="sw booked" />Booked</li>
              <li><span className="sw small" />Too small</li>
            </ul>
            {failed ? <p className="status-error" role="alert">The table map could not be loaded. Use the list of tables instead.</p> : null}
            <svg className="seat-floor" viewBox={`0 0 ${zone.layout!.width} ${zone.layout!.height}`} role="group" aria-label={`Floor plan of ${zone.name}`} data-testid="seat-floor">
              <rect className="seat-floor-bg" x={0} y={0} width={zone.layout!.width} height={zone.layout!.height} />
              {zone.layout!.elements.map((e, i) => (
                <FloorItem key={`${e.type}-${e.resource_id ?? i}`} e={e} seat={e.resource_id ? seats.get(e.resource_id) ?? null : null}
                  picked={!!e.resource_id && e.resource_id === picked} onPick={setPicked} />
              ))}
            </svg>
            <p className="food-note">Select a table to see its photo, price and free times. Times are checked again when you hold.</p>
          </div>
          {pickedEl && pickedEl.table ? (
            <TablePanel key={pickedEl.resource_id} e={pickedEl} zone={zone} seat={seats.get(pickedEl.resource_id!) ?? null} chosen={chosen}
              starts={(availability.tables.find((t) => t.resource_id === pickedEl.resource_id)?.starts ?? []).filter((s) => Date.parse(s) >= props.fromInstant)}
              {...props} />
          ) : (
            <div className="seat-panel seat-panel-empty">
              <p>Pick a free table on the floor to see it here.</p>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function FloorItem({ e, seat, picked, onPick }: { e: Element; seat: Seat | null; picked: boolean; onPick: (id: string) => void }) {
  const turned = e.rotation === 90 || e.rotation === 270;
  const w = turned ? e.height : e.width;
  const h = turned ? e.width : e.height;
  if (e.type === "TABLE" && e.table && e.resource_id) {
    const state = seat?.state ?? "UNAVAILABLE";
    const round = e.table.shape === "ROUND" || e.table.shape === "BAR_STOOL";
    const cls = `seat-table ${picked ? "pick" : state === "FREE" ? "free" : state === "TOO_SMALL" ? "small" : "booked"}`;
    const choose = () => onPick(e.resource_id!);
    const price = e.table.hourly_paise !== null ? `, ${formatInrPaise(e.table.hourly_paise)} per hour` : "";
    return (
      <g className={cls} transform={`translate(${e.x} ${e.y})`} role="button" tabIndex={0} aria-pressed={picked}
        aria-label={`${e.table.label}, ${e.table.capacity} ${e.table.capacity === 1 ? "seat" : "seats"}, ${STATE_WORD[state]}${price}`}
        data-testid={`seat-${e.table.label}`} onClick={choose}
        onKeyDown={(ev: KeyboardEvent<SVGGElement>) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); choose(); } }}>
        <rect width={w} height={h} rx={round ? Math.min(w, h) / 2 : 10} />
        <text x={w / 2} y={h >= 44 ? h / 2 - 2 : h / 2 + 4} textAnchor="middle">{fitLabel(e.table.label, w)}</text>
        {h >= 44 ? <text className="seats" x={w / 2} y={h / 2 + 14} textAnchor="middle">{e.table.capacity} seats</text> : null}
      </g>
    );
  }
  const round = e.type === "PLANT" || e.type === "PILLAR";
  return (
    <g className={`seat-fixture fx-${e.type.toLowerCase()}`} transform={`translate(${e.x} ${e.y})`} aria-hidden={!e.label}>
      <rect width={w} height={h} rx={round ? Math.min(w, h) / 2 : 4} />
      {e.label && w > 30 && h > 14 ? <text x={w / 2} y={h / 2 + 4} textAnchor="middle">{e.label}</text> : null}
    </g>
  );
}

function TablePanel({ e, zone, seat, chosen, starts, slug, duration, party, timezone }: {
  e: Element; zone: Zone; seat: Seat | null; chosen: string; starts: string[]; slug: string; duration: number; party: number; timezone: string;
}) {
  const table = e.table!;
  const [when, setWhen] = useState(starts.includes(chosen) ? chosen : starts[0] ?? null);
  const tooSmall = table.capacity < party;
  const total = seat && seat.state === "FREE" && when === chosen && "total_paise" in seat.price ? seat.price.total_paise : null;
  const href = when ? `/venues/${slug}/book?resource=${e.resource_id}&start=${encodeURIComponent(when)}&duration=${duration}&party=${party}` : null;
  return (
    <aside className="seat-panel" aria-labelledby="seat-panel-heading" data-testid="seat-panel">
      {table.photo ? <img className="seat-photo" src={`/api/v1/media/${table.photo.id}`} alt={table.photo.alt_text} /> : null}
      <div className="seat-panel-head">
        <div>
          <h3 id="seat-panel-heading">{table.label}</h3>
          <p className="food-note">{zone.name} · {KIND_LABEL[zone.kind]}</p>
        </div>
        {table.hourly_paise !== null ? <p className="seat-price">{formatInrPaise(table.hourly_paise)}/hr<span>per table</span></p> : null}
      </div>
      <ul className="chips">
        <li className="chip">Seats {table.capacity}</li>
        {table.features.map((f) => <li key={f} className="chip">{FEATURE_LABEL[f] ?? f}</li>)}
      </ul>
      {tooSmall ? (
        <p className="notice" role="status">This table seats {table.capacity}. Choose fewer people or another table.</p>
      ) : starts.length === 0 ? (
        <p className="notice" role="status">{table.label} has no free start for {durationLabel(duration)} at these times.</p>
      ) : (
        <fieldset className="seat-starts">
          <legend>{seat?.state === "FREE" ? "Start time · IST" : `Booked at ${formatVenueTime(chosen, timezone)} · free at`}</legend>
          <div className="choice-pills">
            {starts.slice(0, 12).map((s) => (
              <label key={s} className={`choice-pill${s === when ? " selected" : ""}`}>
                <input type="radio" name="table-start" checked={s === when} onChange={() => setWhen(s)} />
                {formatVenueTime(s, timezone)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {href && !tooSmall && when ? (
        <>
          <p className="seat-total">
            <span>{formatVenueTime(when, timezone)} · {durationLabel(duration)} · {party} {party === 1 ? "guest" : "guests"}</span>
            {total !== null ? <strong>{formatInrPaise(total)}</strong> : null}
          </p>
          {seat && seat.state === "FREE" && when === chosen && "total_paise" in seat.price && busyHourText(seat.price) ? (
            <p className="food-note" data-testid="seat-busy">Includes a busy-hour price ({busyHourText(seat.price)}).</p>
          ) : null}
          <a className="button block" href={href} data-testid="seat-hold">Hold {table.label} at {formatVenueTime(when, timezone)}</a>
          <p className="food-note">No compulsory food order. Nothing is charged until you pay.</p>
        </>
      ) : null}
    </aside>
  );
}
