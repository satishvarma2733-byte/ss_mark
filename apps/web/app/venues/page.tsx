import { ArrowUpRight, Info, List, Map as MapIcon, MapPin } from "lucide-react";
import { CATEGORY_CODES, venueSearchQuerySchema, type VenueSearchItem, type VenueSearchResult } from "@simply-sit/contracts";
import { asAnon, DomainError, getDb, venuePhotos } from "@simply-sit/db";
import { VenuePhoto } from "../../components/venue-photo";
import { FOOD_RULE_LABEL, formatInrPaise, istInstant } from "../../lib/format";
import { runVenueSearch } from "../../lib/search";
import { tagLabel } from "../../lib/labels";
import { SearchForm, type SearchCriteria } from "../search-form";

export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;
const KEYS = ["area", "lat", "lng", "date", "time", "duration", "party", "requirement", "category", "env", "amenities", "available", "view", "cursor"] as const;

function criteriaFrom(sp: Record<string, string | string[] | undefined>): SearchCriteria & { cursor?: string } {
  const out: Record<string, string> = {};
  for (const key of KEYS) {
    const value = sp[key];
    if (typeof value === "string" && value.length > 0 && value.length <= 200) out[key] = value;
  }
  if (out.lat && out.lng && !out.area) out.area = "device";
  return out;
}

function withParams(criteria: Record<string, string | undefined>, patch: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...criteria, ...patch })) {
    if (value && !(key === "area" && value === "device")) params.set(key, value);
  }
  return `/venues?${params.toString()}`;
}

function availabilityText(item: VenueSearchItem, time: string | undefined) {
  const a = item.availability;
  if (!a) return null;
  if (a.available_tables > 0) return { tone: "status-success", text: `${a.available_tables} table${a.available_tables === 1 ? "" : "s"} free at ${time}` };
  if (a.problems.includes("BOOKED")) return { tone: "status-warning", text: `Fully booked at ${time}` };
  if (a.problems.includes("OUTSIDE_HOURS")) return { tone: "status-warning", text: `Not open for that whole time` };
  return { tone: "status-warning", text: "Not bookable at that time" };
}

// Greedy de-overlap for map pins. Checked against the narrowest map (288 x 480 px at a 320 px viewport); wider maps
// only add space, so pins that clear here clear everywhere. A pin is nudged up or down in 48 px rows (44 px pill plus a
// gap) within the free band between the area label and the selected-venue card, and left off the map if no row fits.
const PIN_MAP_W = 288;
const PIN_MAP_H = 480;
const PIN_ROW = 10; // percent of PIN_MAP_H = 48 px

function placePins(venues: VenueSearchItem[], x: (lng: number) => number, y: (lat: number) => number) {
  const placed: { cx: number; cy: number; w: number }[] = [];
  const out: { v: VenueSearchItem; i: number; left: number; top: number }[] = [];
  venues.forEach((v, i) => {
    const price = v.from_hourly_paise !== null ? formatInrPaise(v.from_hourly_paise) : `${i + 1}`;
    const text = i === 0 ? `${price} · ${v.name}` : price;
    const w = 48 + text.length * 8; // icon, gap, padding and ~8 px per character at 13 px semibold
    const left = x(v.lng);
    const cx = (left / 100) * PIN_MAP_W;
    const base = y(v.lat);
    const top = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5]
      .map((step) => base + step * PIN_ROW)
      .filter((t) => t >= 20 && t <= 70)
      .find((t) => placed.every((p) => Math.abs(p.cx - cx) >= (p.w + w) / 2 + 4 || Math.abs(p.cy - (t / 100) * PIN_MAP_H) >= (PIN_ROW / 100) * PIN_MAP_H - 0.5));
    if (top === undefined) return;
    placed.push({ cx, cy: (top / 100) * PIN_MAP_H, w });
    out.push({ v, i, left, top });
  });
  return out;
}

// Illustrative area map (Figma "Location browsing map"): no map provider is configured yet (owner account needed), so
// the roads and parks are decorative and price pins are placed by relative coordinates. The list stays the primary view.
function AreaMap({ result, criteria }: { result: VenueSearchResult; criteria: Record<string, string | undefined> }) {
  const points = result.venues.map((v) => ({ lat: v.lat, lng: v.lng }));
  if (result.area) points.push({ lat: result.area.lat, lng: result.area.lng });
  if (points.length === 0) return null;
  const minLat = Math.min(...points.map((p) => p.lat)) - 0.005;
  const maxLat = Math.max(...points.map((p) => p.lat)) + 0.005;
  const minLng = Math.min(...points.map((p) => p.lng)) - 0.005;
  const maxLng = Math.max(...points.map((p) => p.lng)) + 0.005;
  // Pins stay inside the panel, clear of the area label (top) and the selected-venue card (bottom).
  const x = (lng: number) => 14 + ((lng - minLng) / (maxLng - minLng)) * 72;
  const y = (lat: number) => 22 + ((maxLat - lat) / (maxLat - minLat)) * 46;
  const selected = result.venues[0];
  return (
    <div className="area-map" role="group" aria-label="Illustrative area map of results">
      <span className="park north" aria-hidden="true" />
      <span className="park south" aria-hidden="true" />
      <span className="roads neighbourhood" aria-hidden="true">
        <img src="/design/map-neighbourhood-roads.svg" alt="" width={354} height={552} />
      </span>
      <span className="roads main" aria-hidden="true">
        <img src="/design/map-main-road.svg" alt="" width={583} height={796} />
      </span>
      <span className="roads main-centre" aria-hidden="true">
        <img src="/design/map-main-road-centre.svg" alt="" width={576} height={792} />
      </span>
      <div className="area-label">
        <strong>{result.area?.source === "device" ? "Near you" : (result.area?.label ?? "Results")}</strong>
        <span>Bengaluru</span>
      </div>
      {result.area ? (
        <span
          className="map-origin-dot"
          style={{ left: `${x(result.area.lng)}%`, top: `${y(result.area.lat)}%` }}
          role="img"
          aria-label={result.area.source === "device" ? "Your approximate location" : `${result.area.label} centre`}
        />
      ) : null}
      {/* Pins for the first eight results only, never overlapping; every result stays in the list. */}
      {placePins(result.venues.slice(0, 8), x, y).map(({ v, i, left, top }) => {
        const full = v.availability ? v.availability.available_tables === 0 : false;
        const price = v.from_hourly_paise !== null ? formatInrPaise(v.from_hourly_paise) : null;
        // The accessible name is the visible text plus hidden context, so speech users can say what they see.
        return (
          <a
            key={v.id}
            className={`map-pin-pill${i === 0 ? " selected" : ""}${full ? " muted" : ""}`}
            style={{ left: `${left}%`, top: `${top}%` }}
            href={`/venues/${v.slug}${detailQuery(criteria)}`}
          >
            <MapPin size={15} aria-hidden="true" />
            <span className="visually-hidden">{i === 0 ? `${i + 1}. From ` : `${i + 1}. ${v.name}${price ? ", from " : ""}`}</span>
            {price ?? (i === 0 ? "" : `${i + 1}`)}
            {price ? <span className="visually-hidden"> per hour</span> : null}
            {i === 0 ? `${price ? " · " : ""}${v.name}` : ""}
          </a>
        );
      })}
      {selected ? (
        <div className="selected-venue">
          <p className="title-row">
            <span>{selected.name}</span>
            <ArrowUpRight size={20} aria-hidden="true" />
          </p>
          <p className="meta">
            {selected.distance_m !== null ? `${(selected.distance_m / 1000).toFixed(1)} km · ` : ""}
            {tagLabel(selected.category_code)}
            {selected.max_capacity ? ` · Seats ${selected.max_capacity}` : ""}
          </p>
          {selected.from_hourly_paise !== null ? (
            <p className="rate">
              From {formatInrPaise(selected.from_hourly_paise)} / table / hour ·{" "}
              <a href={`/venues/${selected.slug}${detailQuery(criteria)}`}>View space →</a>
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="map-scale">
        <span>Illustrative area map · Locations approximate</span>
        <span>No map provider in this preview</span>
      </p>
    </div>
  );
}

function detailQuery(criteria: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const key of ["date", "time", "duration", "party"] as const) if (criteria[key]) params.set(key, criteria[key]!);
  const text = params.toString();
  return text ? `?${text}` : "";
}

// C03 - list/map of published venues for the criteria; never invents results outside the pilot area.
export default async function VenuesPage({ searchParams }: { searchParams: Search }) {
  const criteria = criteriaFrom(await searchParams);
  const raw: Record<string, string> = {};
  if (criteria.area && criteria.area !== "device") raw.area = criteria.area;
  if (criteria.area === "device" && criteria.lat && criteria.lng) {
    raw.lat = criteria.lat;
    raw.lng = criteria.lng;
  }
  if (criteria.date && criteria.time) {
    raw.start_at = istInstant(criteria.date, criteria.time);
    raw.duration_minutes = criteria.duration ?? "60";
  }
  if (criteria.party) raw.party_size = criteria.party;
  if (criteria.requirement) raw.requirement = criteria.requirement;
  if (criteria.category) raw.category = criteria.category;
  if (criteria.env) raw.environment_tags = criteria.env;
  if (criteria.amenities) raw.amenities = criteria.amenities;
  if (criteria.available === "true" && raw.start_at) raw.available_only = "true";
  if (criteria.cursor) raw.cursor = criteria.cursor;

  const parsed = venueSearchQuerySchema.safeParse(raw);
  let result: VenueSearchResult | null = null;
  let problem: string | null = parsed.success ? null : "Some search details are not valid. Check the fields and search again.";
  if (parsed.success) {
    try {
      result = await runVenueSearch(parsed.data);
    } catch (error) {
      problem =
        error instanceof DomainError && error.code === "INVALID_CURSOR"
          ? "That page link is no longer valid. Start the search again."
          : error instanceof DomainError && error.code === "VALIDATION_FAILED"
            ? "Some search details are not valid. Check the fields and search again."
            : "We could not load spaces right now. Your search is kept; try again.";
    }
  }
  // First approved photo per result (same public rule as /api/v1/media). A failed lookup only hides photos.
  const covers = new Map<string, { id: string; alt_text: string }>();
  if (result && result.venues.length > 0) {
    try {
      await asAnon(getDb(), async (tx) => {
        for (const v of result!.venues) {
          const first = (await venuePhotos(tx, v.id))[0];
          if (first) covers.set(v.id, first);
        }
      });
    } catch {
      covers.clear();
    }
  }

  // "list" shows the list alone; the default (and "map") shows the list beside the illustrative map, as in the design.
  const view = criteria.view === "list" ? "list" : "map";
  const selectedCategories = (criteria.category ?? "").split(",").filter(Boolean);
  const when = [
    criteria.date ? new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${criteria.date}T00:00:00Z`)) : null,
    criteria.time ? `${criteria.time} IST` : null,
    criteria.party ? `${criteria.party} ${criteria.party === "1" ? "guest" : "guests"}` : null
  ].filter(Boolean);

  return (
    <main>
      <div className="discover-intro">
        <div>
          <h1>A place for your next good hour.</h1>
          <p className="lede">Cafés, lounges and workspaces. Book the table, not a compulsory meal.</p>
        </div>
        <a className="area-link" href="/venues?area=koramangala">
          Bengaluru · Explore the neighbourhood
        </a>
      </div>
      <SearchForm initial={criteria} showFilters />

      {/* Figma "Discovery filters": venue-type chips apply at once; the view switch sits on the right. */}
      <div className="discovery-filters">
        <nav aria-label="Venue type" className="chips">
          <a className="chip" href={withParams(criteria, { category: undefined, cursor: undefined })} aria-current={selectedCategories.length === 0 ? "true" : undefined}>
            All spaces
          </a>
          {CATEGORY_CODES.map((code) => (
            <a key={code} className="chip" href={withParams(criteria, { category: code, cursor: undefined })}
              aria-current={selectedCategories.length === 1 && selectedCategories[0] === code ? "true" : undefined}>
              {tagLabel(code)}
            </a>
          ))}
        </nav>
        <nav aria-label="Result view" className="chips">
          <a className="chip" href={withParams(criteria, { view: "list", cursor: undefined })} aria-current={view === "list" ? "page" : undefined}>
            <List size={15} aria-hidden="true" />
            List
          </a>
          <a className="chip" href={withParams(criteria, { view: "map", cursor: undefined })} aria-current={view === "map" ? "page" : undefined}>
            <MapIcon size={15} aria-hidden="true" />
            List + map
          </a>
        </nav>
      </div>

      {problem ? (
        <section className="notice status-error" role="alert">
          <p>{problem}</p>
          <p>
            <a href={withParams(criteria, { cursor: undefined })}>Try again</a>
          </p>
        </section>
      ) : null}

      {result ? (
        <div className={view === "map" && result.venues.length > 0 ? "results-layout with-map" : "results-layout"}>
          <section aria-labelledby="results-heading">
            <div className="results-heading">
              <div>
                <h2 id="results-heading" aria-live="polite">
                  {result.total} {result.total === 1 ? "space" : "spaces"}
                  {result.area ? (result.area.source === "device" ? " near you" : ` around ${result.area.label}`) : ""}
                </h2>
                {when.length > 0 ? <p>{when.join(" · ")}</p> : null}
              </div>
            </div>

            {result.venues.length === 0 ? (
              <div className="notice" data-testid="search-empty">
                <p>No spaces match these details yet.</p>
                <ul>
                  {criteria.available ? (
                    <li>
                      <a href={withParams(criteria, { available: undefined, cursor: undefined })}>Show booked venues too</a>
                    </li>
                  ) : null}
                  {criteria.time ? (
                    <li>
                      <a href={withParams(criteria, { time: undefined, available: undefined, cursor: undefined })}>Search any time of day</a>
                    </li>
                  ) : null}
                  {criteria.category || criteria.env || criteria.amenities || criteria.requirement ? (
                    <li>
                      <a href={withParams(criteria, { category: undefined, env: undefined, amenities: undefined, requirement: undefined, cursor: undefined })}>
                        Remove filters
                      </a>
                    </li>
                  ) : null}
                  <li>Try another area in the pilot list.</li>
                </ul>
              </div>
            ) : null}

            <ol className="venue-list">
              {result.venues.map((v) => {
                const availability = availabilityText(v, criteria.time);
                const details = [
                  v.max_capacity ? `Up to ${v.max_capacity} ${v.max_capacity === 1 ? "guest" : "guests"} per table` : null,
                  ...v.amenities.slice(0, 3).map((code) => tagLabel(code))
                ].filter(Boolean);
                return (
                  <li key={v.id}>
                    <article className="venue-card" data-testid="venue-card">
                      <VenuePhoto
                        className="venue-photo"
                        mediaId={covers.get(v.id)?.id ?? null}
                        alt={covers.get(v.id)?.alt_text ?? ""}
                        width={220}
                        height={208}
                        placeholderText="No photo yet"
                      />
                      <div className="venue-info">
                        <div className="venue-top">
                          <p className="eyebrow">{tagLabel(v.category_code)}</p>
                          {v.is_synthetic ? <span className="badge">Synthetic demo</span> : null}
                        </div>
                        <h3 className="venue-title">
                          <a href={`/venues/${v.slug}${detailQuery(criteria)}`}>{v.name}</a>
                        </h3>
                        <p className="venue-meta">
                          {v.locality}
                          {v.distance_m !== null ? ` · ${(v.distance_m / 1000).toFixed(1)} km` : ""}
                        </p>
                        {details.length > 0 ? <p className="venue-detail">{details.join(" · ")}</p> : null}
                        <p className="venue-detail">
                          Outside food: <strong>{FOOD_RULE_LABEL[v.byo_food]}</strong> · Delivery: <strong>{FOOD_RULE_LABEL[v.outside_delivery]}</strong>
                        </p>
                        <div className="venue-rate">
                          {v.from_hourly_paise !== null ? (
                            <div>
                              <p className="price">
                                <small>From </small>
                                {formatInrPaise(v.from_hourly_paise)}
                                <small> / table / hr</small>
                              </p>
                              <p className="rate-note">Total shown before payment</p>
                            </div>
                          ) : (
                            <span />
                          )}
                          {availability ? (
                            <p className={availability.tone === "status-success" ? "status-pill" : "status-pill warning"} data-testid="availability">
                              {availability.tone === "status-success" ? <img src="/design/status-dot-available.svg" alt="" width={5} height={5} /> : null}
                              {availability.text}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ol>
            {result.next_cursor ? (
              <nav className="pagination" aria-label="More results">
                <a className="chip" href={withParams(criteria, { cursor: result.next_cursor })}>
                  More results →
                </a>
              </nav>
            ) : null}
          </section>

          {view === "map" && result.venues.length > 0 ? (
            <aside className="location-panel" aria-label="Map and booking note">
              <AreaMap result={result} criteria={criteria} />
              <div className="notice info">
                <Info size={19} aria-hidden="true" />
                <div>
                  <strong>Book ahead, settle in</strong>
                  <p>Live availability is checked again when you reserve. A place shown on the map isn’t a guaranteed walk-in seat.</p>
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
