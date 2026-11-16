import { notFound } from "next/navigation";
import type { StaffArrivals } from "@simply-sit/contracts";
import { asUser, DomainError, getDb, partnerBookingDetail, staffArrivals } from "@simply-sit/db";
import { venueLocalDate } from "../../../../lib/format";
import { gatePortal, PortalBlocked } from "../../../../lib/portal-page";
import { PartnerNav } from "../../../../lib/partner-page";
import type { PartnerBooking } from "../../../../lib/partner-types";
import { BookingActions } from "./booking-actions";

export const dynamic = "force-dynamic";

// P06 - Figma "C · Partner desktop · Check-out and protected turnover": what the venue needs about one booking (time,
// table, party, guest first name, state), check-out, cleaning and table readiness. Staff record a no-show after the grace
// period; managers can cancel for the customer with a full refund. Bookings of other venues are not found.
export default async function PartnerBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const gate = await gatePortal(`/partner/bookings/${id}`, (me) => me.venue_memberships.length > 0);
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const booking = (await asUser(getDb(), gate.identity.claims, (tx) => partnerBookingDetail(tx, id)).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  })) as PartnerBooking;
  // Table readiness and the next arrival on the same table, from the venue's arrivals list for that day.
  const day = (await asUser(getDb(), gate.identity.claims, (tx) => staffArrivals(tx, booking.venue_id, venueLocalDate(330, Date.parse(booking.start_at)))).catch(
    () => null
  )) as StaffArrivals | null;
  const memberships = gate.me.venue_memberships;
  const current = memberships.find((m) => m.venue_id === booking.venue_id) ?? memberships[0]!;
  const table = day?.tables.find((t) => t.label === booking.resource_label) ?? null;
  const next =
    day?.bookings
      .filter((b) => b.table_label === booking.resource_label && b.booking_id !== booking.booking_id && Date.parse(b.start_at) >= Date.parse(booking.end_at))
      .filter((b) => b.status === "CONFIRMED" || b.status === "CHECKED_IN")
      .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))[0] ?? null;
  const viewer = { role: current.role };

  return (
    <main>
      <h1>{booking.status === "CHECKED_IN" ? "A thoughtful handover." : `Booking ${booking.public_ref}`}</h1>
      <PartnerNav current={current} memberships={memberships} active="/partner" />
      <p className="lede page-lede">
        Booking {booking.public_ref} / {booking.status === "CHECKED_IN" ? "Check-out review" : "Booking operations"} ·{" "}
        <a href={`/partner/calendar?venue=${booking.venue_id}`}>Calendar</a> · <a href={`/staff?venue=${booking.venue_id}`}>Arrivals</a>
      </p>
      <BookingActions booking={booking} table={table} next={next} viewer={viewer} />
      <div className="workspace-footer">
        <p>SIMPLY SIT · Partner portal</p>
        <p>Asia/Kolkata</p>
      </div>
    </main>
  );
}
