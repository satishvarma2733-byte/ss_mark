import { Info } from "lucide-react";
import { adminFinanceOverview, asUser, getDb } from "@simply-sit/db";
import { formatInrPaise, formatVenueDateTime } from "../../../../lib/format";
import { gatePortal, PortalBlocked } from "../../../../lib/portal-page";
import { TableScroll } from "../../../../lib/table-scroll";
import { AdminNav } from "../../../../lib/admin-nav";
import { ApproveFeeButton, FeeConfigForm } from "../finance-actions";
import { FinanceTabs } from "../finance-tabs";

export const dynamic = "force-dynamic";

type FeeConfig = {
  fee_config_id: string; config_version: string; status: string; commission_bps: number; platform_fixed_paise: number; effective_from: string;
  is_synthetic: boolean; created_by_me: boolean; version: number;
};

const label = (code: string) => code.toLowerCase().replace(/_/g, " ");

// Figma "D · Admin desktop · Future fee configuration". Dated fee versions: a draft needs a second finance approver, and
// a version applies only to rates set after it takes effect. Accepted bookings keep the fees they were sold with.
export default async function AdminFeesPage() {
  const gate = await gatePortal("/admin/finance/fees", (me) => me.platform_roles.some((r) => r === "SUPERADMIN" || r === "FINANCE"));
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const o = (await asUser(getDb(), gate.identity.claims, (tx) => adminFinanceOverview(tx))) as { fee_configs: FeeConfig[] };
  const now = Date.now();
  const current = o.fee_configs.filter((f) => f.status === "APPROVED" && Date.parse(f.effective_from) <= now).sort((a, b) => Date.parse(b.effective_from) - Date.parse(a.effective_from))[0];
  const drafts = o.fee_configs.filter((f) => f.status === "DRAFT");

  return (
    <main>
      <AdminNav roles={gate.me.platform_roles} active="/admin/finance" />
      <h1>Change future terms, transparently.</h1>
      <p className="lede page-lede">Fee configuration · {current ? `Current ${current.config_version}` : "No active version"} · {drafts.length} draft(s)</p>
      <FinanceTabs active="/admin/finance/fees" />
      <div className="notice info page-lede">
        <Info size={20} aria-hidden="true" />
        <div>
          <strong>Accepted bookings are immutable</strong>
          <p>Fees are snapshotted at booking. No draft or future effective date can change an accepted booking’s price or policy.</p>
        </div>
      </div>
      <div className="partner-layout">
        <div className="book-main">
          <section className="card book-card" aria-labelledby="new-fee-heading">
            <h2 id="new-fee-heading">Proposed future rates</h2>
            <FeeConfigForm />
            <p className="field-hint">The draft takes effect only after another finance admin approves it, and only for rates set after its start.</p>
          </section>
          <section className="card book-card" aria-labelledby="versions-heading">
            <h2 id="versions-heading">Fee versions</h2>
            <TableScroll label="Fee versions">
              <table className="data-table" data-testid="fee-configs">
                <thead>
                  <tr>
                    <th scope="col">Version</th>
                    <th scope="col">Partner commission</th>
                    <th scope="col">Fixed fee</th>
                    <th scope="col">From (IST)</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {o.fee_configs.map((f) => (
                    <tr key={f.fee_config_id} className={f.fee_config_id === current?.fee_config_id ? "row-highlight" : undefined}>
                      <th scope="row">
                        {f.config_version}
                        {f.is_synthetic ? " (sandbox)" : ""}
                      </th>
                      <td>{(f.commission_bps / 100).toFixed(2)}%</td>
                      <td>{formatInrPaise(f.platform_fixed_paise)}</td>
                      <td>{formatVenueDateTime(f.effective_from)}</td>
                      <td>
                        {label(f.status)}
                        {f.status === "DRAFT" ? (f.created_by_me ? " (awaiting another approver)" : <ApproveFeeButton feeConfigId={f.fee_config_id} version={f.version} />) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </section>
        </div>
        <div className="book-side">
          <section className="card book-card" aria-labelledby="confirm-heading">
            <h2 id="confirm-heading">Authorised confirmation</h2>
            <span className={`status-pill ${drafts.length > 0 ? "warm" : "neutral"}`}>
              {drafts.length > 0 ? `${drafts.length} awaiting finance approval` : "Nothing awaiting approval"}
            </span>
            <p className="book-note">
              The person who drafts a version cannot approve it. A second, separately signed-in finance admin approves; the actor, version and time are
              recorded.
            </p>
          </section>
          <section className="card book-card" aria-labelledby="protected-heading">
            <h2 id="protected-heading">Protected bookings</h2>
            <span className="status-pill">
              <img src="/design/status-dot-available.svg" alt="" width={5} height={5} />
              Accepted price · Unchanged
            </span>
            <p className="book-note">Every booking keeps the fee version recorded in its price snapshot. Future changes apply only when a new booking accepts them.</p>
          </section>
        </div>
      </div>
      <div className="workspace-footer">
        <p>SIMPLY SIT · Admin console</p>
        <p>Asia/Kolkata</p>
      </div>
    </main>
  );
}
