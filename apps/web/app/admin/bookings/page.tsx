import { MousePointerClick } from "lucide-react";
import { gatePortal, PortalBlocked } from "../../../lib/portal-page";
import { AdminNav } from "../../../lib/admin-nav";
import { BookingOpsHeading, BookingRecordList, BookingSearchForm, bookingQuery, searchBookings } from "./booking-records";
import { Card } from "../../../components/ui";

export const dynamic = "force-dynamic";

// A03a - bounded booking lookup for support/finance/superadmin with TOTP. Searching by a customer's email is audited.
// Layout follows Figma "Admin · Booking and settlement operations": matching records left, the chosen booking right.
export default async function AdminBookingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const gate = await gatePortal("/admin/bookings", (me) => me.platform_roles.length > 0);
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const q = bookingQuery(await searchParams);
  const result = await searchBookings(gate.identity.claims, q);
  return (
    <main>
      <AdminNav roles={gate.me.platform_roles} active="/admin/bookings" />
      <BookingOpsHeading />
      <BookingSearchForm q={q} />
      <div className="review-layout">
        <BookingRecordList result={result} q={q} />
        <Card className="empty-detail" aria-label="Booking detail">
          <MousePointerClick size={28} aria-hidden="true" />
          <h2>Choose a booking</h2>
          <p className="muted">Open a record on the left to see its payments, refunds, what the money adds up to and its history.</p>
        </Card>
      </div>
    </main>
  );
}
