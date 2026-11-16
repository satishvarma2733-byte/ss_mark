import { Info } from "lucide-react";
import { adminFinanceOverview, asUser, getDb } from "@simply-sit/db";
import { formatInrPaise, formatVenueDateTime } from "../../../../lib/format";
import { gatePortal, PortalBlocked } from "../../../../lib/portal-page";
import { TableScroll } from "../../../../lib/table-scroll";
import { AdminNav } from "../../../../lib/admin-nav";
import { FinanceTabs } from "../finance-tabs";
import { ButtonLink, Card } from "../../../../components/ui";

export const dynamic = "force-dynamic";

type Overview = {
  refunds: {
    by_status: Record<string, { count: number; amount_paise: number }>;
    attention: { refund_id: string; booking_id: string; public_ref: string; amount_paise: number; reason_code: string; status: string;
                 last_error_code: string | null; created_at: string }[];
  };
  reconciliation: { run_id: string; status: string; period_from: string; period_to: string; exception_count: number; started_at: string }[];
};

const label = (code: string) => code.toLowerCase().replace(/_/g, " ");

// Figma "D · Admin desktop · Refunds and disputes queue". Refunds that need attention (failed, unknown or stalled) with
// the provider state; retries and overrides happen on the booking record, where the duplicate-refund guard applies.
export default async function AdminRefundsPage() {
  const gate = await gatePortal("/admin/finance/refunds", (me) => me.platform_roles.some((r) => r === "SUPERADMIN" || r === "FINANCE"));
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const o = (await asUser(getDb(), gate.identity.claims, (tx) => adminFinanceOverview(tx))) as Overview;
  const pending = Object.entries(o.refunds.by_status).filter(([s]) => s !== "PROCESSED");
  const pendingCount = pending.reduce((n, [, s]) => n + s.count, 0);
  const pendingPaise = pending.reduce((n, [, s]) => n + s.amount_paise, 0);
  const lastRun = o.reconciliation[0] ?? null;

  return (
    <main>
      <AdminNav roles={gate.me.platform_roles} active="/admin/finance" />
      <h1>Every refund, accounted for.</h1>
      <p className="lede page-lede">Finance investigation queue · MOCK payment provider (test mode), no real money moves</p>
      <FinanceTabs active="/admin/finance/refunds" />
      <div className="panel-row page-lede">
        <Card className="book-card" aria-labelledby="pending-heading">
          <h2 id="pending-heading">Pending refunds</h2>
          <dl className="detail-rows">
            <div className="total-row">
              <dt>Not yet confirmed by the provider</dt>
              <dd>
                {pendingCount} · {formatInrPaise(pendingPaise)}
              </dd>
            </div>
          </dl>
          <p className="book-note">{Object.entries(o.refunds.by_status).map(([s, v]) => `${label(s)}: ${v.count}`).join(" · ") || "No refunds yet."}</p>
        </Card>
        <Card className="book-card" aria-labelledby="recon-heading">
          <h2 id="recon-heading">Reconciliation</h2>
          <p className="book-when">
            {lastRun
              ? `Last run ${formatVenueDateTime(lastRun.started_at)} IST · ${label(lastRun.status)} · ${lastRun.exception_count} exception(s)`
              : "No reconciliation run yet."}
          </p>
          <p className="book-note">Provider acknowledgement and bank credit are separate. No refund is marked credited without confirmation.</p>
        </Card>
      </div>

      <div className="partner-layout">
        <Card className="book-card" aria-labelledby="queue-heading">
          <h2 id="queue-heading">Refunds needing attention</h2>
          {o.refunds.attention.length === 0 ? (
            <p className="book-note">No failed, unknown or stalled refunds.</p>
          ) : (
            <TableScroll label="Refunds needing attention">
              <table className="data-table" data-testid="refund-attention">
                <thead>
                  <tr>
                    <th scope="col">Booking</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Provider state</th>
                    <th scope="col">Since</th>
                    <th scope="col">Next action</th>
                  </tr>
                </thead>
                <tbody>
                  {o.refunds.attention.map((r) => (
                    <tr key={r.refund_id} className={r.status === "FAILED" ? "row-highlight" : undefined}>
                      <th scope="row">{r.public_ref}</th>
                      <td>{formatInrPaise(r.amount_paise)}</td>
                      <td>
                        {label(r.status)}
                        {r.last_error_code ? ` (${r.last_error_code})` : ""} · {label(r.reason_code)}
                      </td>
                      <td>{formatVenueDateTime(r.created_at)} IST</td>
                      <td>
                        <a href={`/admin/bookings/${r.booking_id}`}>Investigate →</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
          <p className="book-note">Showing refunds that failed, are unknown or have not progressed. Processing refunds that are on time are not listed.</p>
        </Card>
        <div className="book-side">
          <div className="notice info">
            <Info size={20} aria-hidden="true" />
            <div>
              <strong>Duplicate execution blocked</strong>
              <p>A retry reconciles the existing provider request first; a new refund cannot bypass it. Retries and overrides are made from the booking record.</p>
            </div>
          </div>
          <Card className="book-card" aria-labelledby="dispute-heading">
            <h2 id="dispute-heading">Dispute handling</h2>
            <p className="book-when">A chargeback or dispute never creates a refund automatically. Check overlapping provider cases and the total exposure first.</p>
            <ButtonLink variant="secondary" href="/admin/support">
              Open support cases
            </ButtonLink>
          </Card>
        </div>
      </div>
      <div className="workspace-footer">
        <p>SIMPLY SIT · Admin console</p>
        <p>Asia/Kolkata</p>
      </div>
    </main>
  );
}
