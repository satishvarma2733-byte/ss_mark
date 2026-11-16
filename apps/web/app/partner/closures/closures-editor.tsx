"use client";

// P04 closures - Figma "C · Partner desktop · Add closure and review impacts". The server applies a closure only when
// no hold or booking overlaps it; otherwise nothing is applied and the affected bookings come back for review. A closure
// never cancels, shortens or moves a stay.
import { useState, type FormEvent } from "react";
import { Check, Clock3 } from "lucide-react";
import { formatVenueDateTime, istInstant, venueLocalDate } from "../../../lib/format";
import type { VenueOverview } from "../../../lib/partner-types";
import { conflictsOf, useAction } from "../../../lib/use-action";
import { TableScroll } from "../../../lib/table-scroll";
import { Status } from "../inventory/inventory-editor";

export function ClosuresEditor({ overview }: { overview: VenueOverview }) {
  const venueBase = `/api/v1/partner/venues/${overview.venue.id}`;
  const closure = useAction();
  const today = venueLocalDate();
  const [block, setBlock] = useState({ all: true, resource: overview.resources[0]?.id ?? "", date: today, from: "10:00", untilDate: today, until: "12:00", reason: "" });
  const conflicts = conflictsOf(closure.details);
  const applied = closure.message?.tone === "success";
  const state = conflicts.length > 0 ? "blocked" : applied ? "applied" : "draft";

  function addClosure(event: FormEvent) {
    event.preventDefault();
    void closure.run("closure", "POST", `${venueBase}/closures`, {
      resource_ids: block.all ? null : [block.resource],
      start_at: istInstant(block.date, block.from),
      end_at: istInstant(block.untilDate, block.until),
      reason: block.reason
    }, { idempotent: true, success: "Closure applied. Those times can no longer be booked." });
  }

  return (
    <div className="partner-layout">
      <div className="book-main">
        <form className="card book-card" onSubmit={addClosure} aria-labelledby="closure-heading" id="closure-form">
          <h2 id="closure-heading">Closure details</h2>
          <fieldset className="field closure-tables">
            <legend className="field-label">Tables</legend>
            <label className="check-row">
              <input type="checkbox" checked={block.all} onChange={(e) => setBlock({ ...block, all: e.target.checked })} />
              <span>All tables</span>
            </label>
            {!block.all ? (
              <select className="input" aria-label="Table" value={block.resource} onChange={(e) => setBlock({ ...block, resource: e.target.value })}>
                {overview.resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            ) : null}
          </fieldset>
          <div className="field-pair">
            <div className="field">
              <label className="field-label" htmlFor="c-date">
                Date
              </label>
              <input id="c-date" className="input" type="date" value={block.date} min={today}
                onChange={(e) => setBlock({ ...block, date: e.target.value, untilDate: e.target.value })} data-testid="closure-date" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="c-from">
                Start · IST
              </label>
              <input id="c-from" className="input" type="time" value={block.from} onChange={(e) => setBlock({ ...block, from: e.target.value })} data-testid="closure-from" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="c-until-date">
                End date
              </label>
              <input id="c-until-date" className="input" type="date" value={block.untilDate} min={block.date} onChange={(e) => setBlock({ ...block, untilDate: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="c-until">
                End · IST
              </label>
              <input id="c-until" className="input" type="time" value={block.until} onChange={(e) => setBlock({ ...block, until: e.target.value })} data-testid="closure-until" />
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="c-reason">
              Reason (staff only)
            </label>
            <textarea id="c-reason" className="input" rows={3} value={block.reason} onChange={(e) => setBlock({ ...block, reason: e.target.value })}
              required minLength={3} maxLength={500} placeholder="e.g. Window latch needs repair" data-testid="closure-reason" />
          </div>
          <p className="field-hint">If any hold or booking overlaps, nothing is applied and the affected bookings are listed below.</p>
        </form>

        {conflicts.length > 0 ? (
          <>
            <div className="notice error" role="alert" data-testid="conflicts">
              <img src="/design/circle-alert-error.svg" alt="" width={20} height={20} />
              <div>
                <strong>
                  Conflict · {conflicts.length} {conflicts.length === 1 ? "booking" : "bookings"} affected
                </strong>
                <p>
                  This closure overlaps accepted reservations ({conflicts.map((c) => c.public_ref).filter(Boolean).join(", ") || "another closure"}). A closure
                  cannot silently cancel, shorten or move a confirmed stay.
                </p>
              </div>
            </div>
            <section className="card book-card" aria-labelledby="affected-heading">
              <h2 id="affected-heading">Affected bookings</h2>
              <TableScroll label="Affected bookings">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Booking</th>
                      <th scope="col">Table</th>
                      <th scope="col">Starts · IST</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conflicts.map((c, i) => (
                      <tr key={`${c.public_ref ?? c.kind}-${i}`}>
                        <td>
                          <strong>{c.public_ref ?? "Another closure"}</strong>
                        </td>
                        <td>{c.resource_label ?? "—"}</td>
                        <td>{c.starts_at ? formatVenueDateTime(c.starts_at) : "—"}</td>
                        <td>{c.booking_status ? c.booking_status.toLowerCase() : "closure"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
              <p className="book-note">Paid bookings need the guest’s agreement and a support resolution before any change.</p>
              <a className="button" href={`/partner?venue=${overview.venue.id}`}>
                Open bookings to resolve
              </a>
            </section>
          </>
        ) : null}
      </div>

      <div className="book-side">
        <section className="card book-card" aria-labelledby="apply-heading">
          <h2 id="apply-heading">Apply safely</h2>
          <span className={`status-pill ${state === "blocked" ? "danger" : state === "applied" ? "" : "sage"}`}>
            {state === "applied" ? <img src="/design/status-dot-available.svg" alt="" width={5} height={5} /> : null}
            {state === "blocked" ? "Blocked · Conflict unresolved" : state === "applied" ? "Applied" : "Not applied yet"}
          </span>
          <ol className="stay-timeline">
            <li>
              <span className={`marker ${state === "draft" ? "wait" : "done"}`} aria-hidden="true">
                {state === "draft" ? <Clock3 size={13} /> : <Check size={13} />}
              </span>
              <div>
                <strong>Review impact</strong>
                <p>Bookings and their cleaning buffers are protected</p>
              </div>
            </li>
            <li>
              <span className={`marker ${state === "blocked" ? "wait" : "done"}`} aria-hidden="true">
                {state === "blocked" ? <Clock3 size={13} /> : <Check size={13} />}
              </span>
              <div>
                <strong>Resolve with support</strong>
                <p>Contact the guest and record the agreed outcome. No automatic cancellation.</p>
              </div>
            </li>
            <li>
              <span className={`marker ${state === "applied" ? "done" : "wait"}`} aria-hidden="true">
                {state === "applied" ? <Check size={13} /> : <Clock3 size={13} />}
              </span>
              <div>
                <strong>Revalidate closure</strong>
                <p>Inventory and protected buffers are checked again when you apply.</p>
              </div>
            </li>
          </ol>
          <button className="button" type="submit" form="closure-form" disabled={closure.busy !== null} data-testid="add-closure">
            {closure.busy ? "Checking…" : state === "blocked" ? "Check again & apply" : "Check impact & apply closure"}
          </button>
          <Status message={conflicts.length > 0 ? null : closure.message} />
        </section>

        <section className="card book-card" aria-labelledby="upcoming-heading">
          <h2 id="upcoming-heading">Upcoming closures</h2>
          {overview.closures.length === 0 ? (
            <p className="book-note">No upcoming closures.</p>
          ) : (
            <ul className="case-list" data-testid="closures">
              {overview.closures.map((c) => (
                <ClosureItem key={c.id} closure={c} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function ClosureItem({ closure }: { closure: VenueOverview["closures"][number] }) {
  const action = useAction();
  return (
    <li>
      <strong className="case-title">{closure.resource_label}</strong>
      <span className="book-note">
        {formatVenueDateTime(closure.starts_at)} – {formatVenueDateTime(closure.ends_at)} IST · {closure.reason}
      </span>
      <button className="text-link" type="button" disabled={action.busy !== null}
        onClick={() => void action.run("release", "POST", `/api/v1/partner/closures/${closure.id}/release`, { reason: "Released by manager" }, { success: "Closure ended." })}>
        End closure →
      </button>
      <Status message={action.message} />
    </li>
  );
}
