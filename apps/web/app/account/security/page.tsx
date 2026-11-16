import { redirect } from "next/navigation";
import { safeRedirectPath } from "../../../lib/api";
import { resolveIdentity } from "../../../lib/auth/identity";
import { MfaPanel } from "./mfa-panel";

export const dynamic = "force-dynamic";

// Authenticator (TOTP) enrolment and step-up for portal access (docs/06 M2.2 admin/staff MFA).
export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ redirect_path?: string }> }) {
  const identity = await resolveIdentity();
  const { redirect_path } = await searchParams;
  const back = safeRedirectPath(redirect_path ?? "/account");
  if (identity.kind !== "user") redirect(`/sign-in?redirect_path=${encodeURIComponent(`/account/security?redirect_path=${back}`)}`);
  return (
    <main>
      <h1>Authenticator</h1>
      <p className="lede">Partner, staff and admin areas need a code from an authenticator app in addition to your email code.</p>
      <MfaPanel redirectPath={back} />
    </main>
  );
}
