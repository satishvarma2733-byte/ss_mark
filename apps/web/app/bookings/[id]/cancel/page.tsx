import { notFound, redirect } from "next/navigation";
import { cancellationPolicySummary } from "@simply-sit/contracts";
import { DomainError, asAnon, getDb, venuePhotos } from "@simply-sit/db";
import { resolveIdentity } from "../../../../lib/auth/identity";
import { loadBookingDetail, loadCancelPreview } from "../../../../lib/bookings";
import { formatVenueTime } from "../../../../lib/format";
import { VenueIdentity, longDate } from "../../../../components/booking-parts";
import { CancelPanel } from "./cancel-panel";
import { Card, StatusPill } from "../../../../components/ui";

export const dynamic = "force-dynamic";

// C10 - cancel a confirmed booking: the accepted policy, the exact refund at the server clock, an optional reason and
// one confirmation. A booking that can no longer be cancelled (already cancelled, checked in, started) goes back to C08,
// which shows the refund tracking view (Figma "E · Customer web · Cancellation and refund tracking") once cancelled.
export default async function CancelBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const identity = await resolveIdentity();
  if (identity.kind !== "user") redirect(`/sign-in?redirect_path=${encodeURIComponent(`/bookings/${id}/cancel`)}`);
  const booking = await loadBookingDetail(identity.claims, id).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  if (booking.status !== "CONFIRMED") redirect(`/bookings/${id}`);
  const preview = await loadCancelPreview(identity.claims, id).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "INVALID_TRANSITION") redirect(`/bookings/${id}`);
    throw error;
  });
  const photos = await asAnon(getDb(), (tx) => venuePhotos(tx, booking.venue.id)).catch(() => []);
  const tz = booking.venue.timezone;
  const guests = `${booking.party_size} ${booking.party_size === 1 ? "guest" : "guests"}`;

  return (
    <main className="customer-page">
      <p className="page-crumbs">
        SIMPLY SIT / <a href="/bookings">My bookings</a> / <a href={`/bookings/${id}`}>{booking.public_ref}</a> / Cancel
      </p>
      <div className="customer-page-intro">
        <h1>Cancel booking</h1>
        <p className="lede">Plans change. Check the refund below before you confirm.</p>
      </div>
      {booking.venue.is_synthetic ? (
        <div className="pill-row">
          <StatusPill tone="neutral">Synthetic demo booking · mock refund, no real money</StatusPill>
        </div>
      ) : null}
      <div className="book-layout refund-layout">
        <div className="book-main">
          <Card className="book-card" aria-label="Booking">
            <VenueIdentity photo={photos[0] ?? null} venueName={booking.venue.name} detail={`${booking.table.label} · ${guests}`} reference={booking.public_ref} />
            <hr />
            <p className="book-when">
              {longDate(booking.start_at, tz)} · {formatVenueTime(booking.start_at, tz)}–{formatVenueTime(booking.end_at, tz)} IST
            </p>
            <StatusPill>
              <img src="/design/status-dot-available.svg" alt="" width={5} height={5} />
              Confirmed · Pass still valid
            </StatusPill>
          </Card>
          <Card className="book-card" aria-labelledby="policy-heading">
            <h2 id="policy-heading">Accepted cancellation policy</h2>
            <p className="book-when">{cancellationPolicySummary(booking.policy_snapshot)}</p>
            <p className="field-hint">
              Policy version {booking.policy_snapshot.policy_version}, accepted at booking. Current venue rules are not applied retroactively.
            </p>
          </Card>
        </div>
        <div className="book-side">
          <CancelPanel bookingId={id} initial={preview} />
        </div>
      </div>
    </main>
  );
}
