import { asUser, getDb, partnerVenueOverview } from "@simply-sit/db";
import { NotManager, PartnerNav, partnerContext } from "../../../lib/partner-page";
import type { VenueOverview } from "../../../lib/partner-types";
import { PortalBlocked } from "../../../lib/portal-page";
import { ClosuresEditor } from "./closures-editor";

export const dynamic = "force-dynamic";

// P04 closures - Figma "C · Partner desktop · Add closure and review impacts". Managers only; every API call re-checks
// membership and role, and overlapping holds or bookings block the closure.
export default async function PartnerClosuresPage({ searchParams }: { searchParams: Promise<{ venue?: string }> }) {
  const ctx = await partnerContext("/partner/closures", (await searchParams).venue, { manager: true });
  if (ctx.state === "blocked") return <PortalBlocked gate={ctx.gate} />;
  if (ctx.state === "not_manager") return <NotManager current={ctx.current} />;
  const overview = (await asUser(getDb(), ctx.gate.identity.claims, (tx) => partnerVenueOverview(tx, ctx.current.venue_id))) as VenueOverview;
  return (
    <main>
      <h1>Close a table, not a guest’s plans.</h1>
      <PartnerNav current={ctx.current} memberships={ctx.memberships} active="/partner/inventory" />
      <p className="lede page-lede">Inventory / Add closure · Impact review</p>
      <ClosuresEditor overview={overview} />
      <div className="workspace-footer">
        <p>SIMPLY SIT · Partner portal</p>
        <p>{overview.venue.name} · Asia/Kolkata</p>
      </div>
    </main>
  );
}
