import { Info } from "lucide-react";
import { asUser, getDb, partnerStaff } from "@simply-sit/db";
import { NotManager, PartnerNav, partnerContext } from "../../../lib/partner-page";
import type { StaffList } from "../../../lib/partner-types";
import { PortalBlocked } from "../../../lib/portal-page";
import { StaffManager } from "./staff-manager";

export const dynamic = "force-dynamic";

// P08 - Figma "C · Partner desktop · Team and permissions". Managers invite staff by email and revoke access; owners can
// also invite managers. Every change is audited.
export default async function PartnerStaffPage({ searchParams }: { searchParams: Promise<{ venue?: string }> }) {
  const ctx = await partnerContext("/partner/staff", (await searchParams).venue, { manager: true });
  if (ctx.state === "blocked") return <PortalBlocked gate={ctx.gate} />;
  if (ctx.state === "not_manager") return <NotManager current={ctx.current} />;
  const staff = (await asUser(getDb(), ctx.gate.identity.claims, (tx) => partnerStaff(tx, ctx.current.venue_id))) as StaffList;
  return (
    <main>
      <h1>The right access, for every role.</h1>
      <PartnerNav current={ctx.current} memberships={ctx.memberships} active="/partner/staff" />
      <p className="lede">Team &amp; access · {ctx.current.venue_name}</p>
      <div className="notice info partner-notice">
        <Info size={20} aria-hidden="true" />
        <div>
          <strong>Least privilege by default</strong>
          <p>
            Managers do not gain finance rights. {staff.can_invite_managers ? "As owner you can invite managers and staff." : "Only the owner can invite managers."}
          </p>
        </div>
      </div>
      <StaffManager venueId={ctx.current.venue_id} venueName={ctx.current.venue_name} staff={staff} />
      <div className="workspace-footer">
        <p>SIMPLY SIT · Partner portal</p>
        <p>Asia/Kolkata</p>
      </div>
    </main>
  );
}
