import { notFound, redirect } from "next/navigation";
import { DomainError, asAnon, getDb, venuePhotos } from "@simply-sit/db";
import { resolveIdentity } from "../../../lib/auth/identity";
import { loadBookingDetail } from "../../../lib/bookings";
import { CheckoutPanel } from "./checkout-panel";

export const dynamic = "force-dynamic";

// C06 - Figma "E · Customer web · Checkout and payment": the hold with its server deadline, the itemized total and Pay.
// Back/refresh never extends the hold.
export default async function CheckoutPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) notFound();
  const identity = await resolveIdentity();
  if (identity.kind !== "user") redirect(`/sign-in?redirect_path=${encodeURIComponent(`/checkout/${bookingId}`)}`);
  const booking = await loadBookingDetail(identity.claims, bookingId).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  if (booking.status === "CONFIRMED" || booking.status === "CHECKED_IN" || booking.status === "COMPLETED") redirect(`/bookings/${bookingId}`);
  const photos = await asAnon(getDb(), (tx) => venuePhotos(tx, booking.venue.id)).catch(() => []);
  return (
    <main className="customer-page">
      <p className="page-crumbs">SIMPLY SIT / {booking.venue.name} / Review and pay</p>
      <div className="customer-page-intro">
        <h1>Your table. No surprises.</h1>
        <p className="lede">Review &amp; pay · Step 2 of 3 · Not yet confirmed</p>
      </div>
      <CheckoutPanel initial={booking} photo={photos[0] ?? null} />
    </main>
  );
}
