import { asUser, getDb, partnerVenueOverview } from "@simply-sit/db";
import { NotManager, PartnerNav, partnerContext } from "../../../lib/partner-page";
import type { VenueOverview } from "../../../lib/partner-types";
import { PortalBlocked } from "../../../lib/portal-page";
import { InventoryEditor } from "./inventory-editor";

export const dynamic = "force-dynamic";

// P04 - Figma "C · Partner desktop · Table and pricing editor": tables, prices and opening hours. Changes that would
// invalidate a hold or booking are refused with the affected references (pause sales, resolve those bookings, then
// retry); nothing is cancelled silently.
export default async function PartnerInventoryPage({ searchParams }: { searchParams: Promise<{ venue?: string; table?: string }> }) {
  const sp = await searchParams;
  const ctx = await partnerContext("/partner/inventory", sp.venue, { manager: true });
  if (ctx.state === "blocked") return <PortalBlocked gate={ctx.gate} />;
  if (ctx.state === "not_manager") return <NotManager current={ctx.current} />;
  const overview = (await asUser(getDb(), ctx.gate.identity.claims, (tx) => partnerVenueOverview(tx, ctx.current.venue_id))) as VenueOverview;
  const selected = overview.resources.find((r) => r.id === sp.table) ?? overview.resources[0];
  return (
    <main>
      <h1>A table, precisely defined.</h1>
      <PartnerNav current={ctx.current} memberships={ctx.memberships} active="/partner/inventory" />
      <p className="lede page-lede">
        Inventory{selected ? ` / Edit ${selected.label}` : ""} · {overview.resources.length} {overview.resources.length === 1 ? "table" : "tables"}
      </p>
      <InventoryEditor overview={overview} selectedId={selected?.id} />
      <div className="workspace-footer">
        <p>SIMPLY SIT · Partner portal</p>
        <p>{overview.venue.name} · Asia/Kolkata</p>
      </div>
    </main>
  );
}
