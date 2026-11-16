import { redirect } from "next/navigation";
import { resolveIdentity } from "../../lib/auth/identity";
import { loadMe } from "../../lib/me";
import { CasesColumn, HelpColumn, loadSupportData } from "../help/support-centre";
import { AccountActions } from "./account-actions";

export const dynamic = "force-dynamic";

// C14 /account - Figma "E · Customer web · Account and support centre": profile, terms, privacy and sign-out beside the
// help topics, a linked support ticket and the customer's cases (docs/03). Contact details are read-only here.
export default async function AccountPage() {
  const identity = await resolveIdentity();
  if (identity.kind !== "user") redirect("/sign-in?redirect_path=/account");
  const [me, [tickets, bookings]] = await Promise.all([loadMe(identity.claims), loadSupportData(identity.claims)]);
  const active = me.status === "ACTIVE";

  return (
    <main className="customer-page">
      <p className="page-crumbs">SIMPLY SIT / Your account</p>
      <div className="customer-page-intro">
        <h1>A little help, whenever you need it.</h1>
        <p className="lede">Account &amp; support centre</p>
      </div>
      <div className="account-layout">
        <div className="book-side account-column">
          <section className="card book-card" aria-labelledby="profile-heading">
            <h2 id="profile-heading">Your account</h2>
            <div className="field">
              <span className="field-label" id="email-label">
                Email
              </span>
              <p className="input input-static" aria-labelledby="email-label">
                <span data-testid="account-email">{identity.email}</span>
              </p>
            </div>
            <span className={`status-pill${active ? "" : " warm"}`}>
              {active ? <img src="/design/status-dot-available.svg" alt="" width={5} height={5} /> : null}
              Email verified · <span data-testid="account-status">{me.status}</span>
            </span>
            <dl className="detail-rows">
              <div>
                <dt>Sign-in check</dt>
                <dd>{me.aal === "aal2" ? "Authenticator (aal2)" : "Email code (aal1)"}</dd>
              </div>
              {me.venue_memberships.length > 0 ? (
                <div>
                  <dt>Venue roles</dt>
                  <dd data-testid="account-roles">{me.venue_memberships.map((m) => `${m.role} at ${m.venue_name}`).join("; ")}</dd>
                </div>
              ) : null}
              {me.platform_roles.length > 0 ? (
                <div>
                  <dt>Platform roles</dt>
                  <dd>{me.platform_roles.join(", ")}</dd>
                </div>
              ) : null}
            </dl>
            {me.mfa_required_for_portal ? (
              <p className="book-when status-warning">
                Portal access needs an authenticator check. <a href="/account/security">Set up or verify your authenticator</a>.
              </p>
            ) : null}
          </section>
          <AccountActions
            termsRequired={me.terms_required}
            termsVersion={me.current_terms_version}
            privacyVersion={me.current_privacy_version}
            deletionPending={me.status === "DELETION_PENDING"}
          />
        </div>
        <HelpColumn bookings={[...bookings]} signedIn redirectPath="/account" />
        <CasesColumn tickets={[...tickets]} signedIn />
      </div>
    </main>
  );
}
