import { asUser, getDb, partnerVenueOverview } from "@simply-sit/db";
import { NotManager, PartnerNav, partnerContext } from "../../../lib/partner-page";
import type { VenueOverview } from "../../../lib/partner-types";
import { PortalBlocked } from "../../../lib/portal-page";
import { VenueEditor } from "./venue-editor";

export const dynamic = "force-dynamic";

// P03 - venue profile, rules (policy draft), amenities/tags and photos; submit for review. Managers/owners only.
export default async function PartnerVenuePage({ searchParams }: { searchParams: Promise<{ venue?: string }> }) {
  const ctx = await partnerContext("/partner/venue", (await searchParams).venue, { manager: true });
  if (ctx.state === "blocked") return <PortalBlocked gate={ctx.gate} />;
  if (ctx.state === "not_manager") return <NotManager current={ctx.current} />;
  const overview = (await asUser(getDb(), ctx.gate.identity.claims, (tx) => partnerVenueOverview(tx, ctx.current.venue_id))) as VenueOverview;
  return (
    <main>
      <h1>Venue</h1>
      <PartnerNav current={ctx.current} memberships={ctx.memberships} active="/partner/venue" />
      <VenueEditor overview={overview} />
    </main>
  );
}
