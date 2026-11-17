import { PartnerNav } from "../../lib/partner-page";
import { PortalBlocked, gatePortal } from "../../lib/portal-page";
import { StaffArrivals } from "./staff-arrivals";
import { StaffExtensions } from "./staff-extensions";

export const dynamic = "force-dynamic";

// P02/P06 staff arrivals. Signed-in, assigned, MFA-verified staff only; every action is re-checked by the database.
export default async function StaffArrivalsPage({ searchParams }: { searchParams: Promise<{ venue?: string }> }) {
  const gate = await gatePortal("/staff", (me) => me.venue_memberships.length > 0);
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const { venue } = await searchParams;
  const memberships = gate.me.venue_memberships;
  const current = memberships.find((m) => m.venue_id === venue) ?? memberships[0]!;

  const q = `?venue=${current.venue_id}`;
  return (
    <main>
      <h1>Staff arrivals</h1>
      <PartnerNav current={current} memberships={memberships} active="/staff" />
      <p className="lede page-lede">
        {current.venue_name} ({current.role.toLowerCase()}) · Validate the guest, not the screenshot: check the code here, never a photo of a pass.
      </p>
      <StaffExtensions venueId={current.venue_id} />
      <StaffArrivals venueId={current.venue_id} incidentHref={`/partner/incidents/new${q}`} todayHref={`/partner${q}`} />
    </main>
  );
}
