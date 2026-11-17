import { CURRENT_POLICY_VERSION } from "@simply-sit/domain";
import { adminReleaseSwitches, asUser, getDb } from "@simply-sit/db";
import { AdminNav } from "../../../lib/admin-nav";
import { gatePortal, PortalBlocked } from "../../../lib/portal-page";
import { getProviders, getServerEnv } from "../../../lib/server-env";
import { ButtonLink, Card, StatusPill } from "../../../components/ui";

export const dynamic = "force-dynamic";

// Figma "Admin · System settings" (94:20609). Read-only: it shows the configuration this deployment is actually running
// with. Nothing is editable here on purpose - there is no reviewed, audited change flow for these values yet, so a
// "save draft" button would be a fake. Sales can be paused on Release switches; fees change on the Fees page.
export default async function AdminSettingsPage() {
  const gate = await gatePortal("/admin/settings", (me) => me.platform_roles.length > 0);
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const env = getServerEnv();
  const providers = getProviders();
  const { items } = await asUser(getDb(), gate.identity.claims, (tx) => adminReleaseSwitches(tx));
  const rows: [string, string, string][] = [
    ["Display timezone", "Asia/Kolkata (IST)", "All times in the product are shown in IST."],
    ["Currency", "INR · ₹", "Amounts are stored in paise and shown in rupees."],
    ["Checkout hold", "Set per venue (1 to 30 minutes)", "Each venue's approved policy carries its own hold time."],
    ["Policy version", CURRENT_POLICY_VERSION, "Commercial policies are proposed values until the owner approves them."],
    ["Notification routing", "Inbox for every update; email for essential updates and optional copies", "People choose optional copies under Account > Notification preferences."],
    ["Payment provider", "mock", "Test mode. No real money moves."],
    ["Email provider", providers.email.mode, "Mock mode records messages without sending them."],
    ["Maps provider", providers.maps.mode, "Mock mode uses the illustrated area map."],
    ["Minimum app version", env.NATIVE_MIN_VERSION ?? "Not set", "Older Android and iOS builds are asked to update before starting a booking."],
    ["Environment", env.APP_MODE, "Shown on the health endpoint as well."]
  ];
  return (
    <main>
      <AdminNav roles={gate.me.platform_roles} active="/admin/settings" />
      <h1>System settings</h1>
      <p className="lede">Operational configuration this deployment is running with. Read-only.</p>
      <div className="ops-columns wide-side" style={{ marginTop: 16 }}>
        <div className="ops-main">
          <Card aria-labelledby="config-heading">
            <h2 id="config-heading">Operational configuration</h2>
            <dl className="settings-list" data-testid="system-settings">
              {rows.map(([label, value, note]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>
                    <strong>{value}</strong>
                    <span>{note}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="fine-print">
              Venue hours, prices, lead times and buffers are venue-specific. Accepted booking prices and policy snapshots never change retroactively.
            </p>
          </Card>
        </div>
        <div className="ops-side">
          <Card aria-labelledby="sales-heading">
            <h2 id="sales-heading">Sales switches</h2>
            <dl className="detail-rows">
              {items.map((item) => (
                <div key={item.key}>
                  <dt>{item.key === "BOOKINGS" ? "New bookings" : item.key === "EXTENSIONS" ? "Extensions" : "Payout release"}</dt>
                  <dd>
                    <StatusPill tone={item.is_open ? "success" : "warm"}>{item.is_open ? "Open" : "Paused"}</StatusPill>
                  </dd>
                </div>
              ))}
            </dl>
            <ButtonLink variant="secondary" block href="/admin/release">
              Open release switches
            </ButtonLink>
          </Card>
          <Card aria-labelledby="security-heading">
            <h2 id="security-heading">Security &amp; data controls</h2>
            <p className="muted">Permissions are role-based and every sensitive action is audited. This page does not define retention periods.</p>
            <ButtonLink variant="secondary" block href="/admin/users">
              Open admin access controls
            </ButtonLink>
            <ButtonLink variant="secondary" block href="/admin/audit">
              View audit log
            </ButtonLink>
          </Card>
        </div>
      </div>
    </main>
  );
}
