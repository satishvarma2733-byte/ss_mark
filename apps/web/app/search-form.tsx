"use client";

// C01/C03 search criteria. Manual pilot area works without location permission; "Use my location" asks only after a
// tap, rounds to about 1 km before anything leaves the browser, and falls back to manual entry on denial (no re-prompt).
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CalendarDays, ChevronDown, Clock3, LocateFixed, MapPin, Search, SlidersHorizontal, Users } from "lucide-react";
import { AMENITY_CODES, CATEGORY_CODES, ENVIRONMENT_TAGS, PILOT_AREAS, REQUIREMENT_TAGS, coarseCoordinate } from "@simply-sit/contracts";
import { tagLabel } from "../lib/labels";

export type SearchCriteria = {
  area?: string;
  lat?: string;
  lng?: string;
  date?: string;
  time?: string;
  duration?: string;
  party?: string;
  requirement?: string;
  category?: string;
  env?: string;
  amenities?: string;
  available?: string;
  view?: string;
};

function istDates(count: number): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = Date.now() + 330 * 60_000 + i * 86_400_000;
    const value = new Date(at).toISOString().slice(0, 10);
    const label = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(at));
    out.push({ value, label: i === 0 ? `Today, ${label}` : i === 1 ? `Tomorrow, ${label}` : label });
  }
  return out;
}

const TIMES = Array.from({ length: 36 }, (_, i) => {
  const minutes = 6 * 60 + i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});
const DURATIONS = [60, 90, 120, 150, 180, 210, 240];

function toggle(list: string, code: string): string {
  const set = new Set(list ? list.split(",") : []);
  if (set.has(code)) set.delete(code);
  else set.add(code);
  return [...set].join(",");
}

export function SearchForm({ initial, showFilters = false }: { initial: SearchCriteria; showFilters?: boolean }) {
  const router = useRouter();
  const [criteria, setCriteria] = useState<SearchCriteria>({ area: "koramangala", duration: "60", party: "2", ...initial });
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const set = (patch: Partial<SearchCriteria>) => setCriteria((c) => ({ ...c, ...patch }));
  const usingDevice = criteria.area === "device";

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setLocationNote("Location is not available in this browser. Choose an area instead.");
      return;
    }
    setLocating(true);
    setLocationNote(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        set({ area: "device", lat: String(coarseCoordinate(position.coords.latitude)), lng: String(coarseCoordinate(position.coords.longitude)) });
        setLocationNote("Using your approximate location (about 1 km).");
      },
      () => {
        setLocating(false);
        set({ area: criteria.area === "device" ? "koramangala" : criteria.area });
        setLocationNote("Location was not shared. Choose an area instead; we will not ask again.");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 }
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(criteria)) {
      if (value === undefined || value === "") continue;
      if ((key === "lat" || key === "lng") && !usingDevice) continue;
      if (key === "area" && usingDevice) continue;
      params.set(key, value);
    }
    if (!criteria.time) params.delete("available");
    router.push(`/venues?${params.toString()}`);
  }

  const dates = istDates(14);
  const activeFilters = (["category", "env", "amenities"] as const).reduce(
    (count, key) => count + (criteria[key] ? criteria[key]!.split(",").filter(Boolean).length : 0),
    0
  );
  return (
    <form className="search-card" onSubmit={submit} aria-label="Find a space">
      {/* Figma "Search reservation": four fields and the primary action on one row (stacks on narrow screens). */}
      <div className="search-row">
        <div className="field">
          <label className="field-label" htmlFor="area">
            Location
          </label>
          <div className="field-control">
            <MapPin size={17} aria-hidden="true" />
            <select id="area" value={criteria.area} onChange={(e) => set({ area: e.target.value })}>
              {PILOT_AREAS.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.label}, Bengaluru
                </option>
              ))}
              {usingDevice ? <option value="device">Near me (approximate)</option> : null}
            </select>
            <ChevronDown className="chevron" size={14} aria-hidden="true" />
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="date">
            Date
          </label>
          <div className="field-control">
            <CalendarDays size={17} aria-hidden="true" />
            <select id="date" value={criteria.date ?? ""} onChange={(e) => set({ date: e.target.value })}>
              <option value="">Any day</option>
              {dates.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
            <ChevronDown className="chevron" size={14} aria-hidden="true" />
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="time">
            Start time <span className="visually-hidden">(IST)</span>
          </label>
          <div className="field-control">
            <Clock3 size={17} aria-hidden="true" />
            <select id="time" value={criteria.time ?? ""} onChange={(e) => set({ time: e.target.value, date: criteria.date || dates[0]!.value })}>
              <option value="">Any time</option>
              {TIMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <ChevronDown className="chevron" size={14} aria-hidden="true" />
          </div>
        </div>
        <div className="field">
          <span className="field-label" id="duration-people-label">
            Duration · People
          </span>
          <div className="field-control split" role="group" aria-labelledby="duration-people-label">
            <Users size={17} aria-hidden="true" />
            <label className="visually-hidden" htmlFor="duration">
              Duration
            </label>
            <select id="duration" value={criteria.duration} onChange={(e) => set({ duration: e.target.value })}>
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d % 60 === 0 ? `${d / 60} hour${d === 60 ? "" : "s"}` : `${Math.floor(d / 60)} h ${d % 60} min`}
                </option>
              ))}
            </select>
            <span className="field-divider" aria-hidden="true">
              ·
            </span>
            <label className="visually-hidden" htmlFor="party">
              People
            </label>
            <select id="party" value={criteria.party} onChange={(e) => set({ party: e.target.value })}>
              {Array.from({ length: 10 }, (_, i) => String(i + 1)).map((n) => (
                <option key={n} value={n}>
                  {n} {n === "1" ? "guest" : "guests"}
                </option>
              ))}
            </select>
            <ChevronDown className="chevron" size={14} aria-hidden="true" />
          </div>
        </div>
        <div className="search-action">
          <button className="button" type="submit">
            <Search size={18} aria-hidden="true" />
            Find a space
          </button>
        </div>
      </div>

      <div className="search-extras">
        <button className="text-button" type="button" onClick={useMyLocation} disabled={locating} aria-busy={locating}>
          <LocateFixed size={15} aria-hidden="true" />
          {locating ? "Locating..." : "Use my location"}
        </button>
        <div className="inline-field">
          <label htmlFor="requirement">What for</label>
          <select id="requirement" className="input" value={criteria.requirement ?? ""} onChange={(e) => set({ requirement: e.target.value })}>
            <option value="">Anything</option>
            {REQUIREMENT_TAGS.map((t) => (
              <option key={t} value={t}>
                {tagLabel(t)}
              </option>
            ))}
          </select>
        </div>
        <label className="check-label">
          <input type="checkbox" checked={criteria.available === "true"} disabled={!criteria.time}
            onChange={(e) => set({ available: e.target.checked ? "true" : "" })} /> Only show places with a free table
        </label>
        {locationNote ? (
          <p className="food-note" role="status">
            {locationNote}
          </p>
        ) : null}
      </div>

      {showFilters ? (
        <details className="filters" open={Boolean(criteria.category || criteria.env || criteria.amenities)}>
          <summary className="chip">
            <SlidersHorizontal size={15} aria-hidden="true" />
            More filters{activeFilters > 0 ? ` · ${activeFilters}` : ""}
          </summary>
          {(
            [
              ["Venue type", "category", CATEGORY_CODES],
              ["Atmosphere", "env", ENVIRONMENT_TAGS],
              ["Amenities", "amenities", AMENITY_CODES]
            ] as const
          ).map(([legend, key, codes]) => (
            <fieldset key={key}>
              <legend className="field-label">{legend}</legend>
              {codes.map((code) => (
                <label key={code} className="chip">
                  <input type="checkbox" checked={(criteria[key] ?? "").split(",").includes(code)}
                    onChange={() => set({ [key]: toggle(criteria[key] ?? "", code) })} /> {tagLabel(code)}
                </label>
              ))}
            </fieldset>
          ))}
          <p className="food-note">Choose filters, then select Find a space.</p>
        </details>
      ) : null}
    </form>
  );
}
