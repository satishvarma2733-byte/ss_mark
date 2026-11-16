import { adminFinanceOverview, asUser, getDb } from "@simply-sit/db";
import { formatInrPaise, formatSignedInrPaise, formatVenueDateTime } from "../../../lib/format";
import { gatePortal, PortalBlocked } from "../../../lib/portal-page";
import { DraftPayoutButton, PayoutActions, ReconcileForm } from "./finance-actions";
import { FinanceTabs } from "./finance-tabs";
import { TableScroll } from "../../../lib/table-scroll";
import { AdminNav } from "../../../lib/admin-nav";
import { Card } from "../../../components/ui";

export const dynamic = "force-dynamic";

type Run = {
  run_id: string; status: string; period_from: string; period_to: string; exception_count: number; error_code: string | null;
  provider_captures: number | null; provider_captured_paise: number | null; local_captures: number | null; local_captured_paise: number | null;
  provider_refunds: number | null; local_refunds: number | null; started_at: string;
};
type Batch = {
  payout_batch_id: string; public_ref: string; partner_name: string; status: string; amount_paise: number; earnings_paise: number;
  adjustments_paise: number; items: number; created_by_me: boolean; evidence_ref: string | null; transfer_ref: string | null;
  status_reason: string | null; created_at: string; version: number;
};
type Overview = {
  accounts: { code: string; account_type: string; balance_paise: number }[];
  partner_payable_total_paise: number;
  refunds: {
    by_status: Record<string, { count: number; amount_paise: number }>;
    attention: { refund_id: string; booking_id: string; public_ref: string; amount_paise: number; reason_code: string; status: string;
                 last_error_code: string | null; created_at: string }[];
  };
  reconciliation: Run[];
  partners: { partner_id: string; partner_name: string; payout_enabled: boolean; is_synthetic: boolean; payable_paise: number;
              unallocated_earnings_paise: number; unallocated_adjustments_paise: number; open_batch_id: string | null }[];
  payout_batches: Batch[];
  fee_configs: { fee_config_id: string; config_version: string; status: string; commission_bps: number; platform_fixed_paise: number;
                 effective_from: string; is_synthetic: boolean; created_by_me: boolean; version: number }[];
};

const label = (code: string) => code.toLowerCase().replace(/_/g, " ");

// A05 finance (proposed posting policy, pending finance review): ledger balances, refunds that need attention,
// reconciliation against the payment provider, partner payouts and dated fee versions. Finance/superadmin with TOTP.
// Payouts are recorded here, never transferred by the application.
export default async function AdminFinancePage() {
  const gate = await gatePortal("/admin/finance", (me) => me.platform_roles.some((r) => r === "SUPERADMIN" || r === "FINANCE"));
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const o = (await asUser(getDb(), gate.identity.claims, (tx) => adminFinanceOverview(tx))) as Overview;

  return (
    <main>
      <AdminNav roles={gate.me.platform_roles} active="/admin/finance" />
      <h1>Finance</h1>
      <FinanceTabs active="/admin/finance" />
      <p className="notice status-warning" role="note">
        MOCK payment provider (test mode). No real money moves, and payouts are only recorded here. The posting policy is a proposal
        pending finance review.
      </p>

      <Card aria-labelledby="ledger-heading">
        <h2 id="ledger-heading">Ledger balances</h2>
        <TableScroll label="Ledger balances">
          <table className="data-table">
            <thead><tr><th scope="col">Account</th><th scope="col">Type</th><th scope="col">Balance</th></tr></thead>
            <tbody>
              {o.accounts.map((a) => (
                <tr key={a.code}><td>{label(a.code)}</td><td>{a.account_type.toLowerCase()}</td><td>{formatSignedInrPaise(a.balance_paise)}</td></tr>
              ))}
              <tr><td>partner payables (all partners)</td><td>liability</td><td>{formatSignedInrPaise(o.partner_payable_total_paise)}</td></tr>
            </tbody>
          </table>
        </TableScroll>
      </Card>

      <Card style={{ marginTop: 16 }} aria-labelledby="refunds-heading">
        <h2 id="refunds-heading">Refunds</h2>
        <p>
          {Object.entries(o.refunds.by_status).map(([status, s]) => `${label(status)}: ${s.count} (${formatInrPaise(s.amount_paise)})`).join(" · ") || "None yet."}
        </p>
        <p>
          <a className="text-link" href="/admin/finance/refunds">
            {o.refunds.attention.length > 0 ? `${o.refunds.attention.length} refund(s) need attention →` : "Open the refunds queue →"}
          </a>
        </p>
      </Card>

      <Card style={{ marginTop: 16 }} aria-labelledby="recon-heading">
        <h2 id="recon-heading">Reconciliation</h2>
        <p className="food-note">Compares the provider&apos;s captures and refunds with our records and ledger. A mismatch blocks payouts for that period.</p>
        <ReconcileForm />
        {o.reconciliation.length === 0 ? <p className="food-note">No runs yet.</p> : (
          <TableScroll label="Reconciliation runs">
            <table className="data-table" data-testid="reconciliation-runs">
              <thead>
                <tr><th scope="col">Period (IST)</th><th scope="col">Result</th><th scope="col">Captures provider / ours</th><th scope="col">Refunds provider / ours</th></tr>
              </thead>
              <tbody>
                {o.reconciliation.map((r) => (
                  <tr key={r.run_id}>
                    <td>{formatVenueDateTime(r.period_from)} - {formatVenueDateTime(r.period_to)}</td>
                    <td className={r.status === "MATCHED" ? "status-success" : r.status === "RUNNING" ? undefined : "status-error"}>
                      {r.status === "MISMATCH"
                        ? <a href={`/admin/finance/reconciliation/${r.run_id}`}>{r.exception_count} {r.exception_count === 1 ? "exception" : "exceptions"}</a>
                        : label(r.status)}
                      {r.error_code ? ` (${r.error_code})` : ""}
                    </td>
                    <td>{r.provider_captures ?? "-"} / {r.local_captures ?? "-"}</td>
                    <td>{r.provider_refunds ?? "-"} / {r.local_refunds ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <Card style={{ marginTop: 16 }} aria-labelledby="payout-heading">
        <h2 id="payout-heading">Partner payouts</h2>
        {o.partners.length === 0 ? <p className="food-note">No partner has earnings yet.</p> : (
          <TableScroll label="Partner payables">
            <table className="data-table" data-testid="partner-payables">
              <thead>
                <tr><th scope="col">Partner</th><th scope="col">Payable</th><th scope="col">Unpaid earnings</th><th scope="col">Refund adjustments</th><th scope="col">Action</th></tr>
              </thead>
              <tbody>
                {o.partners.map((p) => (
                  <tr key={p.partner_id} data-testid={`partner-row-${p.partner_id}`}>
                    <td>
                      {p.partner_name}
                      {p.payout_enabled ? "" : " (payout account not connected)"}
                    </td>
                    <td className={p.payable_paise < 0 ? "status-error" : undefined}>{formatSignedInrPaise(p.payable_paise)}</td>
                    <td>{formatInrPaise(p.unallocated_earnings_paise)}</td>
                    <td>{p.unallocated_adjustments_paise > 0 ? `-${formatInrPaise(p.unallocated_adjustments_paise)}` : "-"}</td>
                    <td>{p.open_batch_id ? "Payout open" : <DraftPayoutButton partnerId={p.partner_id} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
        <h3>Payout batches</h3>
        {o.payout_batches.length === 0 ? <p className="food-note">None yet.</p> : (
          <ul style={{ listStyle: "none", padding: 0 }} data-testid="payout-batches">
            {o.payout_batches.map((b) => (
              <Card key={b.payout_batch_id} as="li" style={{ marginBottom: 12 }} data-testid={`payout-${b.public_ref}`}>
                <p>
                  <strong>{b.public_ref}</strong> · {b.partner_name} · <span data-testid="payout-status">{label(b.status)}</span> ·{" "}
                  {formatInrPaise(b.amount_paise)} ({formatInrPaise(b.earnings_paise)} earned
                  {b.adjustments_paise > 0 ? ` less ${formatInrPaise(b.adjustments_paise)} refunds` : ""}, {b.items} items)
                </p>
                {b.evidence_ref ? <p className="food-note">Evidence: {b.evidence_ref}</p> : null}
                {b.transfer_ref && !b.evidence_ref ? <p className="food-note">Transfer: {b.transfer_ref}</p> : null}
                {b.status_reason ? <p className="food-note">Reason: {b.status_reason}</p> : null}
                <PayoutActions batchId={b.payout_batch_id} status={b.status} version={b.version} createdByMe={b.created_by_me} />
              </Card>
            ))}
          </ul>
        )}
      </Card>

      <Card style={{ marginTop: 16 }} aria-labelledby="fee-heading">
        <h2 id="fee-heading">Fee versions</h2>
        <p className="food-note">
          {o.fee_configs.filter((f) => f.status === "DRAFT").length} draft(s) awaiting approval.{" "}
          <a className="text-link" href="/admin/finance/fees">
            Manage fee versions →
          </a>
        </p>
      </Card>
    </main>
  );
}
