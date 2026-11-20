import { asUser, getDb, partnerSeating } from "@simply-sit/db";
import type { PartnerSeating } from "../../../lib/floor-plan";
import { NotManager, PartnerNav, partnerContext } from "../../../lib/partner-page";
import { PortalBlocked } from "../../../lib/portal-page";
import { PriceSetup } from "./price-setup";

export const dynamic = "force-dynamic";

// Seat-map phase 2 - Figma "C · Partner desktop · Area and table pricing" (2070:1707). Step 1: a price per area.
// Step 2: special tables. Every change is a new rate version from now or later; quotes and bookings already made keep
// their price. Busy-hour pricing (step 3 in the design) comes in a later phase.
export default async function PartnerPricesPage({ searchParams }: { searchParams: Promise<{ venue?: string }> }) {
  const sp = await searchParams;
  const ctx = await partnerContext("/partner/prices", sp.venue, { manager: true });
  if (ctx.state === "blocked") return <PortalBlocked gate={ctx.gate} />;
  if (ctx.state === "not_manager") return <NotManager current={ctx.current} />;
  const seating = (await asUser(getDb(), ctx.gate.identity.claims, (tx) => partnerSeating(tx, ctx.current.venue_id))) as PartnerSeating;
  return (
    <main>
      <h1>Set your prices</h1>
      <PartnerNav current={ctx.current} memberships={ctx.memberships} active="/partner/prices" />
      <p className="lede page-lede">
        Give each area a price, then change only the tables that are special. Prices are per table, per hour, and guests always see
        the price before they book.
      </p>
      <PriceSetup seating={seating} />
      <div className="workspace-footer">
        <p>SIMPLY SIT · Partner portal</p>
        <p>{ctx.current.venue_name} · Asia/Kolkata</p>
      </div>
    </main>
  );
}
