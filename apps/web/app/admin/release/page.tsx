import type { ReleaseSwitch } from "@simply-sit/contracts";
import { adminReleaseSwitches, asUser, getDb } from "@simply-sit/db";
import { formatVenueDateTime } from "../../../lib/format";
import { gatePortal, PortalBlocked } from "../../../lib/portal-page";
import { getServerEnv } from "../../../lib/server-env";
import { SwitchForm } from "./switch-form";
import { AdminNav } from "../../../lib/admin-nav";
import { Card } from "../../../components/ui";

export const dynamic = "force-dynamic";

const LABELS: Record<ReleaseSwitch["key"], { label: string; closed: string }> = {
  BOOKINGS: { label: "New bookings", closed: "No new quotes, holds or checkouts. Existing bookings, payments, cancellations, refunds and arrivals continue." },
  EXTENSIONS: { label: "Extensions", closed: "No new extension requests, holds or payments. Bookings keep their current end time." },
  PAYOUTS: { label: "Payout release", closed: "Payout batches cannot be approved or sent for processing. Recording a payout already made stays possible." }
};

// Release switches (M6; docs/06 rollback procedure). Every platform admin sees them; superadmin changes sales and
// extensions, finance may also change payouts. The database enforces them; this page only reads and changes the rows.
export default async function ReleaseSwitchesPage() {
  const gate = await gatePortal("/admin/release", (me) => me.platform_roles.length > 0);
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const { items } = await asUser(getDb(), gate.identity.claims, (tx) => adminReleaseSwitches(tx));
  const minimum = getServerEnv().NATIVE_MIN_VERSION;

  return (
    <main>
      <p>
        <a href="/admin">Admin</a>
      </p>
      <AdminNav roles={gate.me.platform_roles} active="/admin/release" />
      <h1>Release switches</h1>
      <p className="lede">
        Pause new sales during an incident without hiding existing bookings or stopping payments and refunds from being recorded.
      </p>
      {items.map((item) => {
        const text = LABELS[item.key];
        return (
          <Card key={item.key} style={{ marginTop: 16 }} aria-labelledby={`switch-${item.key}`} data-testid={`switch-${item.key}`}>
            <h2 id={`switch-${item.key}`}>
              {text.label}:{" "}
              <span className={item.is_open ? "status-success" : "status-error"} data-testid={`switch-state-${item.key}`}>
                {item.is_open ? "Open" : "Paused"}
              </span>
            </h2>
            {item.is_open ? null : <p>{text.closed}</p>}
            <p className="food-note">
              Last change {formatVenueDateTime(item.changed_at)}{item.changed_by_name ? ` by ${item.changed_by_name}` : ""}
              {item.reason ? `: ${item.reason}` : ""}
            </p>
            {item.can_change ? (
              <SwitchForm switchKey={item.key} isOpen={item.is_open} version={item.version} label={text.label} />
            ) : (
              <p className="food-note">{item.key === "PAYOUTS" ? "Finance or superadmin" : "Superadmin"} can change this.</p>
            )}
          </Card>
        );
      })}
      <Card style={{ marginTop: 16 }} aria-labelledby="native-min">
        <h2 id="native-min">Oldest app version that can book</h2>
        <p data-testid="native-min-version">
          {minimum ? `Android and iOS ${minimum} or newer.` : "Any app version."} Set by the server setting NATIVE_MIN_VERSION; raise it only
          through an approved recovery plan. Older apps keep bookings, receipts, cancellation and support.
        </p>
      </Card>
    </main>
  );
}
