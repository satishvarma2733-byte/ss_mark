import { Clock3 } from "lucide-react";
import { asUser, DomainError, getDb, partnerBookingDetail } from "@simply-sit/db";
import { EMERGENCY_NUMBER } from "@simply-sit/contracts";
import { formatInrPaise, formatVenueTime } from "../../../../lib/format";
import { PartnerNav, partnerContext } from "../../../../lib/partner-page";
import type { PartnerBooking } from "../../../../lib/partner-types";
import { PortalBlocked } from "../../../../lib/portal-page";
import { longDate } from "../../../../components/booking-parts";
import { IncidentForm } from "./incident-form";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

// Figma "C · Partner desktop · Report incident". Venue staff and managers report an incident at their venue, optionally
// about one booking there (?booking=). Reports go to Simply Sit support; staff see only their own reports.
export default async function ReportIncidentPage({ searchParams }: { searchParams: Promise<{ venue?: string; booking?: string }> }) {
  const sp = await searchParams;
  const ctx = await partnerContext("/partner/incidents/new", sp.venue);
  if (ctx.state === "blocked") return <PortalBlocked gate={ctx.gate} />;
  const claims = ctx.state === "ok" ? ctx.gate.identity.claims : null;
  const booking =
    claims && sp.booking && UUID.test(sp.booking)
      ? ((await asUser(getDb(), claims, (tx) => partnerBookingDetail(tx, sp.booking!)).catch((error: unknown) => {
          if (error instanceof DomainError && error.code === "NOT_FOUND") return null;
          throw error;
        })) as PartnerBooking | null)
      : null;
  const venueBooking = booking && booking.venue_id === ctx.current.venue_id ? booking : null;

  return (
    <main>
      <h1>Record clearly. Escalate safely.</h1>
      <PartnerNav current={ctx.current} memberships={ctx.memberships} active="/partner" />
      <p className="lede page-lede">Today / Report an incident · {ctx.current.venue_name}</p>
      <div className="partner-layout">
        <IncidentForm venueId={ctx.current.venue_id} booking={venueBooking} />
        <div className="book-side">
          {venueBooking ? (
            <section className="card book-card" aria-labelledby="ref-heading">
              <h2 id="ref-heading">Booking reference</h2>
              <span className="status-pill">
                <img src="/design/status-dot-available.svg" alt="" width={5} height={5} />
                {venueBooking.status.replace("_", " ").toLowerCase()}
              </span>
              <p className="book-when strong">
                {venueBooking.guest_name ?? "Guest"} · {venueBooking.resource_label}
              </p>
              <p className="book-when">
                {longDate(venueBooking.start_at)} · {formatVenueTime(venueBooking.start_at)}–{formatVenueTime(venueBooking.end_at)} IST · {venueBooking.party_size}{" "}
                {venueBooking.party_size === 1 ? "guest" : "guests"}
              </p>
              {venueBooking.total_paise !== null ? (
                <dl className="detail-rows">
                  <div>
                    <dt>Paid total</dt>
                    <dd>{formatInrPaise(venueBooking.total_paise)}</dd>
                  </div>
                </dl>
              ) : null}
              <p className="field-hint">Guest contact is masked. Use the booking reference, not personal contact details, in notes.</p>
            </section>
          ) : null}
          <div className="notice warm">
            <Clock3 size={20} aria-hidden="true" />
            <div>
              <strong>Immediate danger?</strong>
              <p>
                Put safety first and call local emergency services ({EMERGENCY_NUMBER} in India). Then escalate to support; do not wait for a ticket
                response.
              </p>
            </div>
          </div>
          <section className="card book-card" aria-labelledby="after-heading">
            <h2 id="after-heading">After submission</h2>
            <p className="book-when">Support reviews the report and assigns a case owner. Confidential reports are visible only to senior support staff.</p>
            <p className="book-note">Any closure or guest remedy needs a separate, reasoned action. Every action records who did it and when.</p>
            <a className="button secondary" href="/help">
              Contact support
            </a>
          </section>
        </div>
      </div>
      <div className="workspace-footer">
        <p>SIMPLY SIT · Partner portal</p>
        <p>Asia/Kolkata</p>
      </div>
    </main>
  );
}
