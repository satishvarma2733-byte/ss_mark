import { notFound, redirect } from "next/navigation";
import { DomainError } from "@simply-sit/db";
import { resolveIdentity } from "../../../../lib/auth/identity";
import { loadBookingDetail } from "../../../../lib/bookings";
import { formatVenueDateTime } from "../../../../lib/format";
import { ReviewForm } from "./review-form";
import { Card } from "../../../../components/ui";

export const dynamic = "force-dynamic";

const MODERATION: Record<string, string> = {
  PENDING: "Thanks - your review is waiting for a quick check before it appears.",
  PUBLISHED: "Your review is published on the venue page.",
  HIDDEN: "Your review was not published because it did not meet the review guidelines."
};

// C12 - one review per completed booking, by its customer. Reviews are checked before they appear on the venue page.
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const identity = await resolveIdentity();
  if (identity.kind !== "user") redirect(`/sign-in?redirect_path=${encodeURIComponent(`/bookings/${id}/review`)}`);
  const booking = await loadBookingDetail(identity.claims, id).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  return (
    <main>
      <p>
        <a href={`/bookings/${id}`}>Back to booking</a>
      </p>
      <h1>Rate your visit</h1>
      <p>
        <strong>{booking.venue.name}</strong> · {formatVenueDateTime(booking.start_at)} IST
      </p>
      {booking.review ? (
        <Card data-testid="review-status">
          <p>{"★".repeat(booking.review.rating)}{"☆".repeat(5 - booking.review.rating)} ({booking.review.rating} of 5)</p>
          {booking.review.body ? <p>{booking.review.body}</p> : null}
          <p className="food-note">{MODERATION[booking.review.moderation_status]}</p>
        </Card>
      ) : booking.status === "COMPLETED" ? (
        <ReviewForm bookingId={id} />
      ) : (
        <p className="notice">You can review this visit after it is completed.</p>
      )}
    </main>
  );
}
