"use client";

// P04 - Figma "C · Partner desktop · Table and pricing editor". One table at a time (identity, rate, hours) beside a
// publish summary and the table list. Times are entered in venue-local time (IST) and sent as RFC 3339 instants with the
// +05:30 offset. Blackouts live on /partner/closures (Figma "Add closure and review impacts").
import { useState, type FormEvent } from "react";
import { Info } from "lucide-react";
import { formatInrPaise, formatVenueDateTime, istInstant, venueLocalDate } from "../../../lib/format";
import { WEEKDAY_NAMES, type PartnerResource, type VenueOverview } from "../../../lib/partner-types";
import { conflictsOf, useAction, type ActionMessage, type Conflict } from "../../../lib/use-action";
import { TableScroll } from "../../../lib/table-scroll";
import { Button, Card, StatusPill } from "../../../components/ui";

export function Status({ message }: { message: ActionMessage | null }) {
  return message ? (
    <p className={`book-when status-${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
      {message.text}
    </p>
  ) : null;
}

export function Conflicts({ conflicts, hint }: { conflicts: Conflict[]; hint: string }) {
  if (conflicts.length === 0) return null;
  return (
    <div className="notice error" role="alert" data-testid="conflicts">
      <img src="/design/circle-alert-error.svg" alt="" width={20} height={20} />
      <div>
        <strong>These holds or bookings are in the way</strong>
        <p>{hint}</p>
        <ul className="plain-list">
          {conflicts.map((c, i) => (
            <li key={`${c.public_ref ?? c.kind}-${i}`}>
              {c.public_ref ? <strong>{c.public_ref}</strong> : "Another blackout"} · {c.resource_label ?? ""}{" "}
              {c.starts_at ? `· ${formatVenueDateTime(c.starts_at)} IST` : ""} {c.booking_status ? `· ${c.booking_status.toLowerCase()}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const rupeesToPaise = (value: string) => Math.round(Number(value) * 100);
const minutesText = (value: unknown) => (typeof value === "number" ? (value % 60 === 0 && value >= 60 ? `${value / 60} h` : `${value} minutes`) : "Not set");
const STATUS_TEXT: Record<PartnerResource["status"], string> = { ACTIVE: "Open for booking", PAUSED: "Paused", RETIRED: "Retired" };

function TableEditor({ r, policy }: { r: PartnerResource; policy: Record<string, unknown> | null }) {
  const action = useAction();
  const [label, setLabel] = useState(r.label);
  const [capacity, setCapacity] = useState(String(r.capacity));
  const [price, setPrice] = useState("");
  const [from, setFrom] = useState("");
  const [reason, setReason] = useState("");
  const base = `/api/v1/partner/resources/${r.id}`;
  const conflicts = conflictsOf(action.details);

  return (
    <>
      <form className="card book-card" data-testid={`table-${r.label}`} aria-labelledby="identity-heading" onSubmit={(e) => {
        e.preventDefault();
        void action.run("edit", "PATCH", base, { label, capacity: Number(capacity), expected_version: r.version }, { success: "Table saved." });
      }}>
        <h2 id="identity-heading">Table identity</h2>
        <span className={`status-pill ${r.status === "ACTIVE" ? "" : "warm"}`}>
          {r.status === "ACTIVE" ? <img src="/design/status-dot-available.svg" alt="" width={5} height={5} /> : null}
          {STATUS_TEXT[r.status]}
          {r.pause_reason ? ` · ${r.pause_reason}` : ""}
        </span>
        <div className="field-pair">
          <div className="field">
            <label className="field-label" htmlFor="t-label">
              Table name
            </label>
            <input id="t-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={80} />
            <p className="field-hint">Unique within this venue. Guests see it on their pass.</p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="t-capacity">
              Capacity
            </label>
            <input id="t-capacity" className="input" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
            <p className="field-hint">Seats at this table. Bookings need an exact fit.</p>
          </div>
        </div>
        <Button variant="secondary" type="submit" disabled={action.busy !== null}>
          Save table
        </Button>
      </form>

      <form className="card book-card" aria-labelledby="rate-heading" onSubmit={(e) => {
        e.preventDefault();
        void action.run("rate", "POST", `${base}/rates`, {
          hourly_paise: rupeesToPaise(price), ...(from ? { effective_from: istInstant(from, "00:00") } : {}), expected_version: r.version
        }, { success: "New price saved. Existing bookings keep their price." });
      }}>
        <h2 id="rate-heading">Rate &amp; booking rules</h2>
        <div className="field-pair">
          <div className="field">
            <label className="field-label" htmlFor="t-rate">
              New hourly rate · per table (₹)
            </label>
            <input id="t-rate" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required
              placeholder={r.current_rate ? String(r.current_rate.hourly_paise / 100) : "200"} data-testid={`rate-${r.label}`} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="t-from">
              Apply to new bookings from (IST)
            </label>
            <input id="t-from" className="input" type="date" min={venueLocalDate()} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
        </div>
        <dl className="detail-rows">
          <div>
            <dt>Minimum duration</dt>
            <dd>{minutesText(policy?.minimum_minutes)}</dd>
          </div>
          <div>
            <dt>Booking increments</dt>
            <dd>{minutesText(policy?.increment_minutes)}</dd>
          </div>
          <div>
            <dt>Minimum lead time</dt>
            <dd>{minutesText(policy?.lead_minutes)}</dd>
          </div>
          <div>
            <dt>Cleaning buffer</dt>
            <dd>{minutesText(policy?.buffer_minutes)}</dd>
          </div>
        </dl>
        <p className="field-hint">
          Rate is per table, not per guest. Duration, increments, lead time and buffer are venue rules, changed on the venue profile. The guest platform
          fee is shown separately at checkout.
        </p>
        <Button variant="secondary" type="submit" disabled={action.busy !== null}>
          Set price
        </Button>
      </form>

      <Card className="book-card" aria-labelledby="pause-heading">
        <h2 id="pause-heading">Availability</h2>
        {r.status === "ACTIVE" ? (
          <>
            <div className="field">
              <label className="field-label" htmlFor="t-reason">
                Reason (staff only)
              </label>
              <input id="t-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. repair"
                data-testid={`pause-reason-${r.label}`} />
            </div>
            <div className="action-pair">
              <Button variant="secondary" type="button" disabled={action.busy !== null || reason.trim().length < 3} data-testid={`pause-${r.label}`}
                onClick={() => void action.run("pause", "POST", `${base}/pause`, { reason, expected_version: r.version }, { success: "New bookings for this table are paused." })}>
                Pause new bookings
              </Button>
              <Button variant="secondary" type="button" disabled={action.busy !== null || reason.trim().length < 3}
                onClick={() => void action.run("retire", "POST", `${base}/retire`, { reason, expected_version: r.version }, { success: "Table retired." })}>
                Retire table (owner)
              </Button>
            </div>
          </>
        ) : r.status === "PAUSED" ? (
          <Button variant="secondary" type="button" disabled={action.busy !== null} data-testid={`resume-${r.label}`}
            onClick={() => void action.run("resume", "POST", `${base}/resume`, { expected_version: r.version }, { success: "Table open for booking again." })}>
            Resume bookings
          </Button>
        ) : (
          <p className="book-when">This table is retired and cannot be booked.</p>
        )}
        <Status message={conflicts.length > 0 ? null : action.message} />
        <Conflicts conflicts={conflicts} hint="Resolve them first (the booking page has service cancellation), then try again." />
      </Card>
    </>
  );
}

function hoursState(overview: VenueOverview) {
  return WEEKDAY_NAMES.map((_, weekday) => {
    const period = overview.hours.find((h) => h.weekday === weekday);
    return { open: !!period, opens: period?.opens_local ?? "09:00", closes: period?.closes_local ?? "21:00" };
  });
}

export function InventoryEditor({ overview, selectedId }: { overview: VenueOverview; selectedId?: string }) {
  const venueBase = `/api/v1/partner/venues/${overview.venue.id}`;
  const create = useAction();
  const hours = useAction();
  const [table, setTable] = useState({ label: "", capacity: "4", price: "" });
  const [week, setWeek] = useState(() => hoursState(overview));
  const selected = overview.resources.find((r) => r.id === selectedId) ?? overview.resources[0] ?? null;
  const hoursConflicts = conflictsOf(hours.details);

  function saveHours(event: FormEvent) {
    event.preventDefault();
    void hours.run("hours", "PUT", `${venueBase}/hours`, {
      periods: week.flatMap((d, weekday) => (d.open ? [{ weekday, opens_local: d.opens, closes_local: d.closes }] : [])),
      expected_version: overview.venue.version
    }, { success: "Opening hours saved." });
  }

  return (
    <div className="partner-layout">
      <div className="book-main">
        {selected ? (
          <TableEditor key={selected.id} r={selected} policy={overview.active_policy ?? overview.draft_policy} />
        ) : (
          <div className="notice info">
            <Info size={20} aria-hidden="true" />
            <div>
              <strong>No tables yet</strong>
              <p>Add your first table on the right. Each table is booked whole, at its own hourly rate.</p>
            </div>
          </div>
        )}

        <form className="card book-card" onSubmit={saveHours} aria-labelledby="hours-heading">
          <h2 id="hours-heading">Hours &amp; availability</h2>
          <p className="book-note">Bookings plus cleaning time must fit inside these hours. A closing time earlier than the opening time runs past midnight.</p>
          <TableScroll label="Opening hours">
            <table>
              <tbody>
                {week.map((d, i) => (
                  <tr key={WEEKDAY_NAMES[i]}>
                    <th scope="row">{WEEKDAY_NAMES[i]}</th>
                    <td>
                      <label className="check-row">
                        <input type="checkbox" checked={d.open} onChange={(e) => setWeek(week.map((x, j) => (j === i ? { ...x, open: e.target.checked } : x)))}
                          data-testid={`open-${i}`} />
                        <span>Open</span>
                      </label>
                    </td>
                    <td>
                      <input className="input" type="time" aria-label={`${WEEKDAY_NAMES[i]} opens`} value={d.opens} disabled={!d.open}
                        onChange={(e) => setWeek(week.map((x, j) => (j === i ? { ...x, opens: e.target.value } : x)))} />
                    </td>
                    <td>
                      <input className="input" type="time" aria-label={`${WEEKDAY_NAMES[i]} closes`} value={d.closes} disabled={!d.open}
                        onChange={(e) => setWeek(week.map((x, j) => (j === i ? { ...x, closes: e.target.value } : x)))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <p className="field-hint">Bookings must fit hours, lead time, exact table capacity, holds, closures and cleaning buffers.</p>
          <Button type="submit" disabled={hours.busy !== null} data-testid="save-hours">
            Save hours
          </Button>
          <Status message={hoursConflicts.length > 0 ? null : hours.message} />
          <Conflicts conflicts={hoursConflicts} hint="Change the hours so they still fit, or resolve those bookings first." />
        </form>
      </div>

      <div className="book-side">
        {selected ? (
          <Card className="book-card" aria-labelledby="summary-heading">
            <h2 id="summary-heading">Publish summary</h2>
            <StatusPill tone="sage">
              <img src="/design/status-dot-brand.svg" alt="" width={5} height={5} />
              {STATUS_TEXT[selected.status]}
            </StatusPill>
            <dl className="detail-rows">
              <div>
                <dt>Table</dt>
                <dd>
                  {selected.label} · seats {selected.capacity}
                </dd>
              </div>
              <div>
                <dt>Rate</dt>
                <dd>{selected.current_rate ? `${formatInrPaise(selected.current_rate.hourly_paise)} / table / hr` : "No current price"}</dd>
              </div>
              {selected.next_rate ? (
                <div>
                  <dt>From {formatVenueDateTime(selected.next_rate.effective_from)} IST</dt>
                  <dd>{formatInrPaise(selected.next_rate.hourly_paise)} / hr</dd>
                </div>
              ) : null}
            </dl>
            <div className="notice info">
              <Info size={20} aria-hidden="true" />
              <div>
                <strong>Existing stays stay intact</strong>
                <p>Changes never alter accepted prices, durations or policies. Conflicts must be resolved before a schedule change can go live.</p>
              </div>
            </div>
            <p className="field-hint">Every change revalidates inventory and records who changed what, and when.</p>
          </Card>
        ) : null}

        <Card className="book-card" aria-labelledby="tables-heading">
          <h2 id="tables-heading">Tables</h2>
          <ul className="table-list">
            {overview.resources.map((r) => (
              <li key={r.id}>
                <a href={`/partner/inventory?venue=${overview.venue.id}&table=${r.id}`} aria-current={r.id === selected?.id ? "true" : undefined}>
                  <strong>{r.label}</strong>
                  <span>
                    Seats {r.capacity} · {r.current_rate ? `${formatInrPaise(r.current_rate.hourly_paise)}/hr` : "No price"} · {STATUS_TEXT[r.status]}
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <a className="text-link" href={`/partner/closures?venue=${overview.venue.id}`}>
            Add a closure and review impacts →
          </a>
        </Card>

        <form className="card book-card" onSubmit={(e) => {
          e.preventDefault();
          void create.run("create", "POST", `${venueBase}/resources`, {
            label: table.label, capacity: Number(table.capacity), hourly_paise: rupeesToPaise(table.price)
          }, { idempotent: true, success: "Table added." }).then((r) => r.ok && setTable({ label: "", capacity: "4", price: "" }));
        }} aria-labelledby="add-table-heading">
          <h2 id="add-table-heading">Add a table</h2>
          <div className="field">
            <label className="field-label" htmlFor="new-label">
              New table name
            </label>
            <input id="new-label" className="input" value={table.label} onChange={(e) => setTable({ ...table, label: e.target.value })} required maxLength={80}
              data-testid="new-table-label" />
          </div>
          <div className="field-pair">
            <div className="field">
              <label className="field-label" htmlFor="new-capacity">
                Seats
              </label>
              <input id="new-capacity" className="input" inputMode="numeric" value={table.capacity} onChange={(e) => setTable({ ...table, capacity: e.target.value })}
                required data-testid="new-table-capacity" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="new-price">
                Price per hour (₹)
              </label>
              <input id="new-price" className="input" inputMode="decimal" value={table.price} onChange={(e) => setTable({ ...table, price: e.target.value })}
                required data-testid="new-table-price" />
            </div>
          </div>
          <Button type="submit" disabled={create.busy !== null} data-testid="add-table">
            Add table
          </Button>
          <Status message={create.message} />
        </form>
      </div>
    </div>
  );
}
