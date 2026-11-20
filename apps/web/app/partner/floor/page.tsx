import { asUser, getDb, partnerSeating, partnerVenueOverview } from "@simply-sit/db";
import type { PartnerSeating } from "../../../lib/floor-plan";
import { NotManager, PartnerNav, partnerContext } from "../../../lib/partner-page";
import type { VenueOverview } from "../../../lib/partner-types";
import { PortalBlocked } from "../../../lib/portal-page";
import { FloorSetup } from "./floor-setup";

export const dynamic = "force-dynamic";

// Seat-map phase 2 - Figma "C · Partner desktop · Dine-in floor setup" (2067:1575). Areas, a drag-and-drop floor
// drawing per area and each table's shape, features and photo. Drafts are private; guests see a drawing only after
// Publish, and publishing never moves a booking.
export default async function PartnerFloorPage({ searchParams }: { searchParams: Promise<{ venue?: string; zone?: string }> }) {
  const sp = await searchParams;
  const ctx = await partnerContext("/partner/floor", sp.venue, { manager: true });
  if (ctx.state === "blocked") return <PortalBlocked gate={ctx.gate} />;
  if (ctx.state === "not_manager") return <NotManager current={ctx.current} />;
  const [seating, overview] = await asUser(getDb(), ctx.gate.identity.claims, async (tx) => [
    (await partnerSeating(tx, ctx.current.venue_id)) as PartnerSeating,
    (await partnerVenueOverview(tx, ctx.current.venue_id)) as VenueOverview
  ] as const);
  const photos = overview.media.filter((m) => m.kind === "PHOTO" && m.status === "APPROVED").map((m) => ({ id: m.id, alt_text: m.alt_text }));
  return (
    <main>
      <h1>Set up your dine-in floor</h1>
      <PartnerNav current={ctx.current} memberships={ctx.memberships} active="/partner/floor" />
      <p className="lede page-lede">
        Draw your café the way guests see it: add areas, place tables where they really are, then give each table its seats, photo
        and features. Guests book from the published floor.
      </p>
      <FloorSetup seating={seating} photos={photos} initialZoneId={sp.zone} venueId={ctx.current.venue_id} />
      <div className="workspace-footer">
        <p>SIMPLY SIT · Partner portal</p>
        <p>{overview.venue.name} · Asia/Kolkata</p>
      </div>
    </main>
  );
}
