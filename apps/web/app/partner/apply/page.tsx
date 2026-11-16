import { redirect } from "next/navigation";
import { Info } from "lucide-react";
import { resolveIdentity } from "../../../lib/auth/identity";
import { loadMe } from "../../../lib/me";
import { PartnerNav } from "../../../lib/partner-page";
import { ApplyForm } from "./apply-form";

export const dynamic = "force-dynamic";

// P01 - Figma "C · Partner desktop · New-partner onboarding". Propose a venue: creates a draft listing owned by the
// applicant; nothing is visible to customers until Simply Sit reviews it. Identity and payout details are never
// collected here (provider-hosted onboarding, M4.4).
export default async function PartnerApplyPage() {
  const identity = await resolveIdentity();
  if (identity.kind !== "user") redirect(`/sign-in?redirect_path=${encodeURIComponent("/partner/apply")}`);
  const me = await loadMe(identity.claims);
  const memberships = me.venue_memberships;
  return (
    <main className={memberships.length > 0 ? undefined : "customer-page"}>
      <h1>A good place starts here.</h1>
      {memberships.length > 0 ? <PartnerNav current={memberships[0]!} memberships={memberships} active="/partner/apply" /> : null}
      <p className="lede">New-partner setup · Onboarding draft · Not yet approved or bookable</p>
      <div className="notice info partner-notice">
        <Info size={20} aria-hidden="true" />
        <div>
          <strong>New application</strong>
          <p>Tell us about the business and the venue. Tables, hours, rules and photos come next. Completing setup does not mean approval.</p>
        </div>
      </div>
      <ApplyForm />
      <div className="workspace-footer">
        <p>SIMPLY SIT · Partner portal</p>
        <p>Asia/Kolkata</p>
      </div>
    </main>
  );
}
