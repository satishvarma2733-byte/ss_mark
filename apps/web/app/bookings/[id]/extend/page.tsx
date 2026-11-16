import { notFound, redirect } from "next/navigation";
import { DomainError } from "@simply-sit/db";
import { resolveIdentity } from "../../../../lib/auth/identity";
import { loadBookingDetail } from "../../../../lib/bookings";
import { longDate } from "../../../../components/booking-parts";
import { ExtendPanel } from "./extend-panel";
import { StatusPill } from "../../../../components/ui";

export const dynamic = "force-dynamic";

// C11 - Figma "E · Customer web · Active booking and extension". Ask for more time while checked in. Staff decide within
// five minutes; after approval the customer has five minutes to hold the extra time and pay. The end time changes only
// after a verified payment.
export default async function ExtendPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const identity = await resolveIdentity();
  if (identity.kind !== "user") redirect(`/sign-in?redirect_path=${encodeURIComponent(`/bookings/${id}/extend`)}`);
  const booking = await loadBookingDetail(identity.claims, id).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  return (
    <main className="customer-page">
      <p className="page-crumbs">
        SIMPLY SIT / <a href="/bookings">My bookings</a> / <a href={`/bookings/${id}`}>{booking.public_ref}</a> / More time
      </p>
      <div className="customer-page-intro">
        <h1>Stay a little longer, if there’s room.</h1>
        <p className="lede">
          {booking.public_ref} · {booking.venue.name} · {longDate(booking.start_at, booking.venue.timezone)}
        </p>
      </div>
      {booking.venue.is_synthetic ? (
        <div className="pill-row">
          <StatusPill tone="neutral">Synthetic demo booking · mock payment, no real charge</StatusPill>
        </div>
      ) : null}
      <ExtendPanel initial={booking} />
    </main>
  );
}
