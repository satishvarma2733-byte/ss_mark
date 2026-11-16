import { CircleAlert } from "lucide-react";
import { EMERGENCY_NUMBER } from "@simply-sit/contracts";
import { resolveIdentity } from "../../lib/auth/identity";
import { CasesColumn, HelpColumn, loadSupportData } from "./support-centre";

export const dynamic = "force-dynamic";

// C13 - help: answers, emergency guidance, and the customer's own support requests (Figma "E · Customer web · Account
// and support centre", help and case columns). Tickets are private to the person who raised them.
export default async function HelpPage() {
  const identity = await resolveIdentity();
  const signedIn = identity.kind === "user";
  const [tickets, bookings] = signedIn ? await loadSupportData(identity.claims) : ([[], []] as const);

  return (
    <main className="customer-page">
      <p className="page-crumbs">SIMPLY SIT / Help &amp; safety</p>
      <div className="customer-page-intro">
        <h1>A little help, whenever you need it.</h1>
        <p className="lede">Answers, your support cases and safety guidance.</p>
      </div>
      <div className="notice warm" role="note" data-testid="emergency">
        <CircleAlert size={20} aria-hidden="true" />
        <div>
          <strong>In an emergency, call {EMERGENCY_NUMBER}</strong>
          <p>Or ask venue staff for help right away. Support requests here are not monitored for emergencies.</p>
        </div>
      </div>
      <div className="book-layout support-layout">
        <HelpColumn bookings={[...bookings]} signedIn={signedIn} redirectPath="/help" />
        <CasesColumn tickets={[...tickets]} signedIn={signedIn} />
      </div>
    </main>
  );
}
