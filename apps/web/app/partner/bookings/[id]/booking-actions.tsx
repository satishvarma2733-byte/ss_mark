"use client";

// Booking operations for venue staff and managers: check-out and protected turnover, table readiness, no-show and
// service cancellation. Readiness is never automatic: the server refuses "ready" while a guest is checked in.
import { useState } from "react";
import { Check, Clock3 } from "lucide-react";
import { SERVICE_CANCEL_REASONS, type StaffArrivals } from "@simply-sit/contracts";
import { formatInrPaise, formatVenueTime } from "../../../../lib/format";
import type { PartnerBooking } from "../../../../lib/partner-types";
import { useAction } from "../../../../lib/use-action";
import { Button, ButtonLink, Card, StatusPill } from "../../../../components/ui";

const REASON_LABEL: Record<string, string> = {
  VENUE_UNAVAILABLE: "Venue unavailable", VENUE_CLOSED: "Venue closed", TABLE_UNAVAILABLE: "Table unavailable", SAFETY: "Safety", OTHER: "Other"
};
const STATE_TEXT: Record<string, string> = { READY: "Ready", OCCUPIED: "Occupied", CLEANING: "Needs cleaning", OUT_OF_SERVICE: "Out of service" };
const ROLE_LABEL: Record<string, string> = { OWNER: "Venue owner", MANAGER: "Venue manager", STAFF: "Front desk" };

type Table = StaffArrivals["tables"][number];
type Next = StaffArrivals["bookings"][number];

export function BookingActions({ booking, table, next, viewer }: { booking: PartnerBooking; table: Table | null; next: Next | null; viewer: { role: string } }) {
  const checkOut = useAction();
  const ready = useAction();
  const noShow = useAction();
  const cancel = useAction();
  const [left, setLeft] = useState(false);
  const [code, setCode] = useState<string>("TABLE_UNAVAILABLE");
  const [reason, setReason] = useState("");
  const confirmed = booking.status === "CONFIRMED";
  const checkedIn = booking.status === "CHECKED_IN";
  const graceOver = Date.parse(booking.server_now) >= Date.parse(booking.start_at) + booking.grace_minutes * 60_000;
  const beforeEnd = Date.parse(booking.server_now) < Date.parse(booking.end_at);
  const statusText = booking.status.replace("_", " ").toLowerCase();
  const checkedOut = !!booking.checked_out_at;

  return (
    <div className="partner-layout">
      <div className="book-main">
        <Card className="book-card" aria-labelledby="departure-heading">
          <h2 id="departure-heading">{checkedIn ? "Review actual departure" : "Booking"}</h2>
          <span className={`status-pill${checkedIn || confirmed ? "" : " neutral"}`} data-testid="partner-booking-status">
            {checkedIn || confirmed ? <img src="/design/status-dot-available.svg" alt="" width={5} height={5} /> : null}
            Status: {statusText}
            {checkedIn ? " · Check-out not recorded" : ""}
          </span>
          <p className="book-when strong">
            {booking.guest_name ?? "Guest"} · {booking.resource_label} · {booking.party_size} {booking.party_size === 1 ? "guest" : "guests"}
          </p>
          <dl className="detail-rows">
            <div>
              <dt>Reserved time</dt>
              <dd>
                {formatVenueTime(booking.start_at)}–{formatVenueTime(booking.end_at)} IST
              </dd>
            </div>
            {booking.checked_in_at ? (
              <div>
                <dt>Checked in</dt>
                <dd>{formatVenueTime(booking.checked_in_at)} IST</dd>
              </div>
            ) : null}
            {booking.checked_out_at ? (
              <div>
                <dt>Checked out</dt>
                <dd>{formatVenueTime(booking.checked_out_at)} IST</dd>
              </div>
            ) : null}
            {booking.total_paise !== null ? (
              <div>
                <dt>Payment (managers only)</dt>
                <dd>{formatInrPaise(booking.total_paise)} · Verified</dd>
              </div>
            ) : null}
          </dl>
          {checkedIn ? (
            <>
              <label className="check-row">
                <input type="checkbox" checked={left} onChange={(e) => setLeft(e.target.checked)} />
                <span>I have checked the guest has left {booking.resource_label}.</span>
              </label>
              <Button type="button" disabled={!left || checkOut.busy !== null} data-testid="partner-check-out"
                onClick={() => void checkOut.run("check-out", "POST", `/api/v1/partner/bookings/${booking.booking_id}/check-out`, { expected_version: booking.version },
                  { idempotent: true, success: "Checked out. The table is now marked for cleaning." })}>
                Record check-out &amp; mark cleaning
              </Button>
              <p className="field-hint">The departure time is the moment you confirm. This never charges extra or confirms an extension.</p>
            </>
          ) : null}
          {checkOut.message ? (
            <p className={`book-when status-${checkOut.message.tone}`} role="status">
              {checkOut.message.text}
            </p>
          ) : null}
        </Card>

        {checkedIn || checkedOut ? (
          <>
            <div className="notice warm">
              <Clock3 size={20} aria-hidden="true" />
              <div>
                <strong>Inventory is still protected</strong>
                <p>Recording departure starts turnover, not availability. Cleaning and the full buffer must both pass before the table can be marked ready.</p>
              </div>
            </div>
            <Card className="book-card" aria-labelledby="turnover-heading">
              <h2 id="turnover-heading">Protected turnover</h2>
              <ol className="stay-timeline">
                <li>
                  <span className={`marker ${checkedOut ? "done" : "wait"}`} aria-hidden="true">
                    {checkedOut ? <Check size={13} /> : <Clock3 size={13} />}
                  </span>
                  <div>
                    <strong>Actual check-out</strong>
                    <p>{checkedOut ? `Recorded ${formatVenueTime(booking.checked_out_at!)} IST` : "Awaiting staff confirmation"}</p>
                  </div>
                </li>
                <li>
                  <span className={`marker ${table?.operational_state === "READY" && checkedOut ? "done" : "wait"}`} aria-hidden="true">
                    {table?.operational_state === "READY" && checkedOut ? <Check size={13} /> : <Clock3 size={13} />}
                  </span>
                  <div>
                    <strong>Cleaning</strong>
                    <p>After check-out, within the venue’s cleaning buffer</p>
                  </div>
                </li>
                <li>
                  <span className={`marker ${table?.operational_state === "READY" && checkedOut ? "done" : "wait"}`} aria-hidden="true">
                    {table?.operational_state === "READY" && checkedOut ? <Check size={13} /> : <Clock3 size={13} />}
                  </span>
                  <div>
                    <strong>Ready for a new stay</strong>
                    <p>Only after cleaning is complete and staff mark the table ready</p>
                  </div>
                </li>
              </ol>
            </Card>
          </>
        ) : null}

        {confirmed && graceOver ? (
          <Card className="book-card" aria-labelledby="ns-heading">
            <h2 id="ns-heading">Guest has not arrived</h2>
            <p className="book-note">The table stays reserved until the booking ends. The customer is told; any refund follows the rules they accepted.</p>
            <Button variant="secondary" type="button" disabled={noShow.busy !== null} data-testid="mark-no-show"
              onClick={() => void noShow.run("no-show", "POST", `/api/v1/partner/bookings/${booking.booking_id}/no-show`, { expected_version: booking.version },
                { idempotent: true, success: "Recorded as a no-show." })}>
              Record no-show
            </Button>
            {noShow.message ? (
              <p className={`book-when status-${noShow.message.tone}`} role="status">
                {noShow.message.text}
              </p>
            ) : null}
          </Card>
        ) : null}

        {booking.can_manage && confirmed && beforeEnd ? (
          <form className="card book-card" aria-labelledby="sc-heading" onSubmit={(e) => {
            e.preventDefault();
            void cancel.run("service-cancel", "POST", `/api/v1/bookings/${booking.booking_id}/service-cancel`,
              { reason_code: code, reason, expected_version: booking.version }, { idempotent: true, success: "Cancelled. A full refund has been requested." });
          }}>
            <h2 id="sc-heading">Cancel for the customer</h2>
            <p className="book-note">Use this only when the venue cannot honour the booking. The customer gets a full refund and a notice with the reason category.</p>
            <div className="field-pair">
              <div className="field">
                <label className="field-label" htmlFor="sc-code">
                  Reason category (shown to the customer)
                </label>
                <select id="sc-code" className="input" value={code} onChange={(e) => setCode(e.target.value)}>
                  {SERVICE_CANCEL_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {REASON_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="sc-reason">
                  What happened (internal, audited)
                </label>
                <input id="sc-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={500}
                  data-testid="service-cancel-reason" />
              </div>
            </div>
            <Button variant="danger" type="submit" disabled={cancel.busy !== null} data-testid="service-cancel">
              Cancel booking with full refund
            </Button>
            {cancel.message ? (
              <p className={`book-when status-${cancel.message.tone}`} role="status">
                {cancel.message.text}
              </p>
            ) : null}
          </form>
        ) : null}
      </div>

      <div className="book-side">
        <Card className="book-card" aria-labelledby="next-heading">
          <h2 id="next-heading">Next arrival protected</h2>
          {next ? (
            <>
              <StatusPill>
                <img src="/design/status-dot-available.svg" alt="" width={5} height={5} />
                Confirmed · Starts {formatVenueTime(next.start_at)}
              </StatusPill>
              <p className="book-when strong">
                {next.table_label} · {next.public_ref} · {formatVenueTime(next.start_at)}–{formatVenueTime(next.end_at)} IST
              </p>
            </>
          ) : (
            <p className="book-when">No later booking on {booking.resource_label} that day.</p>
          )}
          <p className="book-note">Never shorten cleaning or move a confirmed booking to make room. Escalate delays to support.</p>
        </Card>

        <Card className="book-card" aria-labelledby="clean-heading">
          <h2 id="clean-heading">Cleaning controls</h2>
          <dl className="detail-rows">
            <div>
              <dt>Current state</dt>
              <dd>{table ? STATE_TEXT[table.operational_state] ?? table.operational_state : "Unknown"}</dd>
            </div>
          </dl>
          <Button type="button" disabled={!table || table.operational_state !== "CLEANING" || ready.busy !== null}
            onClick={() => table && void ready.run("ready", "POST", `/api/v1/partner/resources/${table.resource_id}/ready`, { expected_version: table.version },
              { idempotent: true, success: "Table marked ready." })}>
            Mark table ready
          </Button>
          <p className="field-hint">Unlocks after check-out, once the table needs cleaning. The server refuses ready while a guest is checked in.</p>
          {ready.message ? (
            <p className={`book-when status-${ready.message.tone}`} role="status">
              {ready.message.text}
            </p>
          ) : null}
        </Card>

        <Card className="book-card" aria-labelledby="incident-heading">
          <h2 id="incident-heading">Something went wrong?</h2>
          <p className="book-when">Report an incident linked to this booking. It creates a support case and changes nothing else.</p>
          <ButtonLink variant="secondary" href={`/partner/incidents/new?venue=${booking.venue_id}&booking=${booking.booking_id}`} data-testid="report-incident-link">
            Report an incident
          </ButtonLink>
        </Card>

        <Card className="book-card" aria-labelledby="audit-heading">
          <h2 id="audit-heading">Audit preview</h2>
          <p className="book-when">You · {ROLE_LABEL[viewer.role] ?? viewer.role}</p>
          <p className="book-note">
            Check-out, cleaning state and timestamps are recorded with your name. The paid time stays {formatVenueTime(booking.start_at)}–{formatVenueTime(booking.end_at)}.
          </p>
        </Card>
      </div>
    </div>
  );
}
