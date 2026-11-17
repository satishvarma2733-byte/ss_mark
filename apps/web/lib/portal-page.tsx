// Shared gate for the partner, staff and admin pages. UI gating only: every API call and database function re-checks.
import { redirect } from "next/navigation";
import { ShieldCheck, ShieldOff } from "lucide-react";
import type { Me } from "@simply-sit/contracts";
import { resolveIdentity, type Identity } from "./auth/identity";
import { loadMe } from "./me";
import { ButtonLink } from "../components/ui";

export type PortalGate =
  | { state: "denied" }
  | { state: "mfa"; path: string }
  | { state: "ok"; identity: Extract<Identity, { kind: "user" }>; me: Me };

export async function gatePortal(path: string, allowed: (me: Me) => boolean): Promise<PortalGate> {
  const identity = await resolveIdentity();
  if (identity.kind !== "user") redirect(`/sign-in?redirect_path=${encodeURIComponent(path)}`);
  const me = await loadMe(identity.claims);
  if (!allowed(me)) return { state: "denied" };
  if (identity.claims.aal !== "aal2") return { state: "mfa", path };
  return { state: "ok", identity, me };
}

// Figma "Admin · Secure admin access" (94:21670): one centred card for both blocked states. The wording and test ids
// are unchanged; the card adds what the area is and that access is role-based and audited.
export function PortalBlocked({ gate }: { gate: Exclude<PortalGate, { state: "ok" }> }) {
  if (gate.state === "denied") {
    return (
      <main>
        <section className="message-page access-gate">
          <span className="message-icon" aria-hidden="true">
            <ShieldOff size={28} />
          </span>
          <p className="eyebrow">Authorised access only</p>
          <h1>No access</h1>
          <p className="notice" data-testid="portal-denied">
            Your account does not have access to this area. If you work at a partner venue, ask your venue manager for an invitation.
          </p>
          <div className="heading-actions">
            <ButtonLink variant="secondary" href="/">
              Back to Simply Sit
            </ButtonLink>
            <ButtonLink variant="secondary" href="/help">
              Recover access through support
            </ButtonLink>
          </div>
        </section>
      </main>
    );
  }
  return (
    <main>
      <section className="message-page access-gate">
        <span className="message-icon" aria-hidden="true">
          <ShieldCheck size={28} />
        </span>
        <p className="eyebrow">Authorised access only</p>
        <h1>Verify it is you</h1>
        <p className="notice" data-testid="portal-mfa-required">
          This area needs a code from your authenticator app.{" "}
          <a href={`/account/security?redirect_path=${encodeURIComponent(gate.path)}`}>Continue to authenticator check</a>
        </p>
        <p className="muted small">Permissions apply to your signed-in role, and sensitive actions are audited.</p>
      </section>
    </main>
  );
}
