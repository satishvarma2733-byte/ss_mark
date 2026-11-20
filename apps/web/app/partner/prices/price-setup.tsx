"use client";

// Seat-map phase 2 - Figma "C · Partner desktop · Area and table pricing" (2070:1707). Area prices go through
// POST /partner/zones/{id}/price (tables with their own price keep it unless told otherwise); a single table goes through
// POST /partner/resources/{id}/rates. Both create rate versions from the chosen start; nothing already booked changes.
import { useState } from "react";
import { Info } from "lucide-react";
import { ZONE_KIND_LABEL, type PartnerSeating, type RateRule, type SeatingTable, type Zone } from "../../../lib/floor-plan";
import { formatInrPaise, istInstant, venueLocalDate } from "../../../lib/format";
import { useAction } from "../../../lib/use-action";
import { Button, Card } from "../../../components/ui";
import { Status } from "../inventory/inventory-editor";

const toPaise = (rupees: string) => Math.round(Number(rupees) * 100);
const validRupees = (rupees: string) => /^\d{1,6}(\.\d{1,2})?$/.test(rupees.trim()) && toPaise(rupees) >= 100;

type Start = { mode: "now" | "later"; date: string; time: string };
const startInstant = (s: Start) => (s.mode === "later" && s.date && s.time ? istInstant(s.date, s.time) : undefined);

function areaPrice(zone: Zone, tables: SeatingTable[]) {
  if (zone.default_hourly_paise !== null) return zone.default_hourly_paise;
  const prices = tables.map((t) => t.hourly_paise).filter((p): p is number => p !== null);
  return prices.length ? Math.min(...prices) : null;
}

export function PriceSetup({ seating }: { seating: PartnerSeating }) {
  const [start, setStart] = useState<Start>({ mode: "now", date: venueLocalDate(), time: "09:00" });
  const groups: { zone: Zone | null; tables: SeatingTable[] }[] = [
    ...seating.zones.map((zone) => ({ zone, tables: seating.tables.filter((t) => t.zone_id === zone.id) })),
    { zone: null, tables: seating.tables.filter((t) => t.zone_id === null) }
  ].filter((g) => g.zone !== null || g.tables.length > 0);
  const from = startInstant(start);

  return (
    <div className="book-layout price-setup" data-testid="price-setup">
      <div className="book-main">
        <Card className="book-card" aria-labelledby="step1-heading">
          <h2 id="step1-heading">Step 1 · Price for each area</h2>
          <p className="book-when">Every table in the area uses this price unless you give it its own in step 2.</p>
          {seating.zones.length === 0 ? (
            <p className="book-when">No areas yet. Add areas on the Floor plan page, or set table prices in step 2.</p>
          ) : (
            <ul className="price-rows">
              {seating.zones.map((z) => (
                <AreaPriceRow key={z.id} zone={z} tables={seating.tables.filter((t) => t.zone_id === z.id)} from={from} />
              ))}
            </ul>
          )}
        </Card>

        <Card className="book-card" aria-labelledby="step2-heading">
          <h2 id="step2-heading">Step 2 · Special tables (optional)</h2>
          <p className="book-when">Charge more for a window seat or less for a bar stool. Leave the rest on the area price.</p>
          {groups.map((g) => (
            <section key={g.zone?.id ?? "none"} className="price-group" aria-label={g.zone?.name ?? "Not in an area"}>
              <h3>{g.zone ? `${g.zone.name} · ${ZONE_KIND_LABEL[g.zone.kind]}` : "Not in an area"}</h3>
              {g.tables.length === 0 ? <p className="field-hint">No tables in this area.</p> : (
                <ul className="price-rows">
                  {g.tables.map((t) => (
                    <TablePriceRow key={t.id} table={t} areaPaise={g.zone ? areaPrice(g.zone, g.tables) : null} from={from} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </Card>

        <BusyHours seating={seating} />
      </div>

      <div className="book-side">
        <Card className="book-card" aria-labelledby="when-heading">
          <h2 id="when-heading">When should new prices start?</h2>
          <fieldset className="chip-checks">
            <legend className="visually-hidden">Start</legend>
            <label className={`choice-pill${start.mode === "now" ? " selected" : ""}`}>
              <input type="radio" name="start" checked={start.mode === "now"} onChange={() => setStart({ ...start, mode: "now" })} />
              Right away
            </label>
            <label className={`choice-pill${start.mode === "later" ? " selected" : ""}`}>
              <input type="radio" name="start" checked={start.mode === "later"} onChange={() => setStart({ ...start, mode: "later" })} />
              From a date
            </label>
          </fieldset>
          {start.mode === "later" ? (
            <div className="field-pair">
              <div className="field">
                <label className="field-label" htmlFor="start-date">Date</label>
                <input id="start-date" className="input" type="date" min={venueLocalDate()} value={start.date} onChange={(e) => setStart({ ...start, date: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="start-time">Time · IST</label>
                <input id="start-time" className="input" type="time" step={900} value={start.time} onChange={(e) => setStart({ ...start, time: e.target.value })} />
              </div>
            </div>
          ) : null}
          <div className="notice info">
            <Info size={20} aria-hidden="true" />
            <div>
              <strong>Bookings already made keep their price</strong>
              <p>Only bookings made for times after the start use the new prices.</p>
            </div>
          </div>
        </Card>
        <Card className="book-card" aria-labelledby="guest-heading" data-testid="guest-preview">
          <h2 id="guest-heading">What guests will see</h2>
          <ul className="plain-list guest-prices">
            {seating.zones.map((z) => {
              const live = seating.tables.filter((t) => t.zone_id === z.id && t.status === "ACTIVE" && t.hourly_paise !== null);
              const min = live.length ? Math.min(...live.map((t) => t.hourly_paise!)) : null;
              return (
                <li key={z.id}>
                  <span>{z.name}</span>
                  <strong>{min !== null ? `from ${formatInrPaise(min)}/hr` : "not bookable yet"}</strong>
                </li>
              );
            })}
          </ul>
          <p className="field-hint">Today’s prices. A change you schedule for later shows from its start time.</p>
        </Card>
      </div>
    </div>
  );
}

function AreaPriceRow({ zone, tables, from }: { zone: Zone; tables: SeatingTable[]; from: string | undefined }) {
  const action = useAction();
  const current = areaPrice(zone, tables);
  const [rupees, setRupees] = useState(current !== null ? String(current / 100) : "");
  // Follow the stored price after a save (the server data refreshes; the row keeps its message).
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setRupees(current !== null ? String(current / 100) : "");
  }
  const [keep, setKeep] = useState(true);
  const valid = validRupees(rupees);
  return (
    <li className="price-row" data-testid={`area-price-${zone.name}`}>
      <div className="price-row-name">
        <strong>{zone.name}</strong>
        <span>{ZONE_KIND_LABEL[zone.kind]} · {tables.length} {tables.length === 1 ? "table" : "tables"}{current !== null ? ` · now ${formatInrPaise(current)}/hr` : ""}</span>
      </div>
      <form className="price-row-form" onSubmit={(e) => {
        e.preventDefault();
        void action.run("area", "POST", `/api/v1/partner/zones/${zone.id}/price`, {
          hourly_paise: toPaise(rupees), keep_custom_prices: keep, expected_version: zone.version, ...(from ? { effective_from: from } : {})
        }, { success: `${zone.name}: ${formatInrPaise(toPaise(rupees))}/hr${from ? " from the chosen start" : " from now"}.` });
      }}>
        <label className="price-input">
          <span>₹</span>
          <input aria-label={`Hourly price for ${zone.name}, rupees`} inputMode="decimal" value={rupees} onChange={(e) => setRupees(e.target.value)} />
          <span>/ hr</span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          <span>Keep special table prices</span>
        </label>
        <Button type="submit" size="sm" disabled={!valid || tables.length === 0} loading={action.busy === "area"}>Apply to area</Button>
      </form>
      <Status message={action.message} />
    </li>
  );
}

function TablePriceRow({ table, areaPaise, from }: { table: SeatingTable; areaPaise: number | null; from: string | undefined }) {
  const action = useAction();
  const [rupees, setRupees] = useState(table.hourly_paise !== null ? String(table.hourly_paise / 100) : "");
  const [seen, setSeen] = useState(table.hourly_paise);
  if (seen !== table.hourly_paise) {
    setSeen(table.hourly_paise);
    setRupees(table.hourly_paise !== null ? String(table.hourly_paise / 100) : "");
  }
  const special = areaPaise !== null && table.hourly_paise !== null && table.hourly_paise !== areaPaise;
  const valid = validRupees(rupees) && toPaise(rupees) !== table.hourly_paise;
  return (
    <li className={`price-row${special ? " special" : ""}`} data-testid={`table-price-${table.label}`}>
      <div className="price-row-name">
        <strong>{table.label}</strong>
        <span>
          {table.capacity} {table.capacity === 1 ? "seat" : "seats"} · {table.hourly_paise !== null ? `${formatInrPaise(table.hourly_paise)}/hr` : "no price"}
          {table.status !== "ACTIVE" ? " · paused" : ""}
        </span>
      </div>
      <span className={`status-pill ${special ? "" : "neutral"}`}>{special ? "Special price" : areaPaise !== null ? "Area price" : "Own price"}</span>
      <form className="price-row-form" onSubmit={(e) => {
        e.preventDefault();
        void action.run("rate", "POST", `/api/v1/partner/resources/${table.id}/rates`, {
          hourly_paise: toPaise(rupees), expected_version: table.version, ...(from ? { effective_from: from } : {})
        }, { success: `${table.label}: ${formatInrPaise(toPaise(rupees))}/hr.` });
      }}>
        <label className="price-input">
          <span>₹</span>
          <input aria-label={`Hourly price for ${table.label}, rupees`} inputMode="decimal" value={rupees} onChange={(e) => setRupees(e.target.value)} />
          <span>/ hr</span>
        </label>
        <Button type="submit" size="sm" variant="secondary" disabled={!valid} loading={action.busy === "rate"}>Set price</Button>
      </form>
      <Status message={action.message} />
    </li>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const endText = (t: string) => (t === "24:00" || t === "00:00" ? "midnight" : t);
// Window text; an end at or before the start runs past midnight into the next day.
const windowText = (from: string, to: string) => `${from}–${endText(to)}${to !== "24:00" && to <= from ? " (next day)" : ""}`;
const percentText = (bps: number) => `${bps > 0 ? "+" : "−"}${Math.abs(bps) / 100}%`;
function daysText(days: number[]) {
  const set = new Set(days);
  if (set.size === 7) return "Every day";
  if ([1, 2, 3, 4, 5].every((d) => set.has(d)) && set.size === 5) return "Mon–Fri";
  if (set.has(0) && set.has(6) && set.size === 2) return "Sat–Sun";
  return DAY_ORDER.filter((d) => set.has(d)).map((d) => DAYS[d]).join(", ");
}

// Step 3 - busy-hour rules: days, a local time window and a percentage up or down, for the whole venue or one area.
function BusyHours({ seating }: { seating: PartnerSeating }) {
  const action = useAction();
  const rules = seating.rate_rules ?? [];
  const [label, setLabel] = useState("Busy evenings");
  const [zone, setZone] = useState("");
  const [days, setDays] = useState(new Set([5, 6, 0]));
  const [from, setFrom] = useState("18:00");
  const [to, setTo] = useState("22:00");
  const [direction, setDirection] = useState<"up" | "down">("up");
  const [percent, setPercent] = useState("20");
  const pct = Number(percent);
  const validPct = Number.isInteger(pct) && pct >= 1 && pct <= (direction === "up" ? 100 : 50);
  const bps = (direction === "up" ? 1 : -1) * pct * 100;
  const sample = seating.tables.find((t) => t.hourly_paise !== null && (!zone || t.zone_id === zone));
  const zoneName = (id: string | null) => (id ? seating.zones.find((z) => z.id === id)?.name ?? "One area" : "All areas");
  const overnight = to !== "" && to <= from && to !== "00:00";
  const valid = label.trim().length > 0 && days.size > 0 && from !== "" && to !== "" && to !== from && validPct;
  return (
    <Card className="book-card" aria-labelledby="step3-heading" data-testid="busy-hours">
      <h2 id="step3-heading">Step 3 · Busy-hour price (optional)</h2>
      <p className="book-when">Charge a little more at busy times, or less at quiet ones. Guests always see the final price before they book.</p>
      {rules.length > 0 ? (
        <ul className="price-rows" data-testid="busy-rules">
          {rules.map((r) => <RuleRow key={r.id} rule={r} area={zoneName(r.zone_id)} />)}
        </ul>
      ) : <p className="field-hint">No busy-hour prices yet.</p>}
      <WeekStrip rules={rules} />
      <form className="busy-form" onSubmit={(e) => {
        e.preventDefault();
        void action.run("rule", "POST", `/api/v1/partner/venues/${seating.venue_id}/rate-rules`, {
          label: label.trim(), zone_id: zone || null, weekdays: [...days], starts_local: from, ends_local: to === "00:00" ? "24:00" : to, adjustment_bps: bps
        }, { idempotent: true, success: `Added “${label.trim()}”: ${percentText(bps)} ${daysText([...days])} ${windowText(from, to === "00:00" ? "24:00" : to)}.` });
      }}>
        <h3>Add a busy-hour price</h3>
        <div className="field-pair">
          <div className="field">
            <label className="field-label" htmlFor="rule-label">Name</label>
            <input id="rule-label" className="input" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="rule-zone">Where</label>
            <select id="rule-zone" className="input" value={zone} onChange={(e) => setZone(e.target.value)}>
              <option value="">All areas</option>
              {seating.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </div>
        </div>
        <fieldset className="chip-checks">
          <legend className="field-label">Days</legend>
          {DAY_ORDER.map((d) => (
            <label key={d} className={`choice-pill${days.has(d) ? " selected" : ""}`}>
              <input type="checkbox" checked={days.has(d)} onChange={(e) => {
                const next = new Set(days);
                if (e.target.checked) next.add(d); else next.delete(d);
                setDays(next);
              }} />
              {DAYS[d]}
            </label>
          ))}
        </fieldset>
        <div className="field-pair">
          <div className="field">
            <label className="field-label" htmlFor="rule-from">From · IST</label>
            <input id="rule-from" className="input" type="time" step={900} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="rule-to">Until · IST</label>
            <input id="rule-to" className="input" type="time" step={900} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="busy-change">
          <fieldset className="chip-checks">
            <legend className="field-label">Price change</legend>
            <label className={`choice-pill${direction === "up" ? " selected" : ""}`}>
              <input type="radio" name="direction" checked={direction === "up"} onChange={() => setDirection("up")} /> More
            </label>
            <label className={`choice-pill${direction === "down" ? " selected" : ""}`}>
              <input type="radio" name="direction" checked={direction === "down"} onChange={() => setDirection("down")} /> Less
            </label>
          </fieldset>
          <label className="price-input">
            <input aria-label="Percentage change" inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value)} />
            <span>%</span>
          </label>
        </div>
        {sample && validPct ? (
          <p className="field-hint" data-testid="busy-example">
            Example: {sample.label} at {formatInrPaise(sample.hourly_paise!)}/hr becomes{" "}
            <strong>{formatInrPaise(Math.round((sample.hourly_paise! * (10000 + bps)) / 10000))}/hr</strong> {daysText([...days])} {windowText(from, to === "00:00" ? "24:00" : to)}.
          </p>
        ) : null}
        {overnight ? <p className="field-hint">This runs past midnight: it starts on the chosen days and ends the next morning.</p> : null}
        {to !== "" && to === from ? <p className="field-hint status-warning">Choose an end time different from the start.</p> : null}
        {!validPct ? <p className="field-hint status-warning">Use 1–100% more or 1–50% less.</p> : null}
        <Button type="submit" disabled={!valid} loading={action.busy === "rule"}>Add busy-hour price</Button>
        <Status message={action.message} />
      </form>
    </Card>
  );
}

function RuleRow({ rule, area }: { rule: RateRule; area: string }) {
  const action = useAction();
  return (
    <li className={`price-row${rule.adjustment_bps > 0 ? " special" : ""}`} data-testid={`busy-rule-${rule.label}`}>
      <div className="price-row-name">
        <strong>{rule.label} · {percentText(rule.adjustment_bps)}</strong>
        <span>{daysText(rule.weekdays)} · {windowText(rule.starts_local, rule.ends_local)} · {area}</span>
      </div>
      <Button size="sm" variant="ghost" loading={action.busy === "archive"}
        onClick={() => void action.run("archive", "POST", `/api/v1/partner/rate-rules/${rule.id}/archive`, undefined, { success: `${rule.label} stopped for new bookings.` })}>
        Stop
      </Button>
      <Status message={action.message} />
    </li>
  );
}

const hours = (t: string) => (t === "24:00" ? 24 : Number(t.slice(0, 2)) + Number(t.slice(3)) / 60);
// The parts of each rule that fall on one weekday: its own window, plus the after-midnight tail of an overnight window
// that started the day before.
function segments(rules: RateRule[], day: number) {
  const out: { key: string; start: number; end: number; up: boolean }[] = [];
  for (const r of rules) {
    const start = hours(r.starts_local);
    const end = hours(r.ends_local);
    const overnight = r.ends_local !== "24:00" && end <= start;
    if (r.weekdays.includes(day)) out.push({ key: `${r.id}-a`, start, end: overnight ? 24 : end, up: r.adjustment_bps > 0 });
    if (overnight && r.weekdays.includes((day + 6) % 7) && end > 0) out.push({ key: `${r.id}-b`, start: 0, end, up: r.adjustment_bps > 0 });
  }
  return out;
}

// A small week view: which days have a busy-hour price, and when.
function WeekStrip({ rules }: { rules: RateRule[] }) {
  if (rules.length === 0) return null;
  return (
    <div className="week-strip" role="img" aria-label={rules.map((r) => `${r.label}: ${daysText(r.weekdays)} ${windowText(r.starts_local, r.ends_local)}, ${percentText(r.adjustment_bps)}`).join(". ")}>
      {DAY_ORDER.map((d) => (
        <div key={d} className="week-day">
          <span>{DAYS[d]}</span>
          <div className="week-bar">
            {segments(rules, d).map((seg) => (
              <i key={seg.key} className={seg.up ? "up" : "down"} style={{ left: `${(seg.start / 24) * 100}%`, width: `${((seg.end - seg.start) / 24) * 100}%` }} />
            ))}
          </div>
        </div>
      ))}
      <p className="field-hint">00:00 ··· 12:00 ··· 24:00 · green = price up, sand = price down</p>
    </div>
  );
}
