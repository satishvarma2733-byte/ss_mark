import type React from "react";
import { Info } from "lucide-react";
import { METRIC_DEFINITIONS, percentOf } from "@simply-sit/contracts";
import { adminBusinessMetrics, asUser, DomainError, getDb } from "@simply-sit/db";
import { formatInrPaise, venueLocalDate } from "../../../lib/format";
import { gatePortal, PortalBlocked } from "../../../lib/portal-page";
import { AdminNav } from "../../../lib/admin-nav";
import { TableScroll } from "../../../lib/table-scroll";
import { Button, Card, StatusPill } from "../../../components/ui";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const pct = (part: number, whole: number) => {
  const value = percentOf(part, whole);
  return value === null ? "-" : `${value}%`;
};

// Figma "Marketplace KPI definitions": metric, value and definition rows.
function Metric({ label, value, definition, testId }: { label: string; value: string; definition: string; testId?: string }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td data-testid={testId}>{value}</td>
      <td className="kpi-definition">{definition}</td>
    </tr>
  );
}

function KpiTable({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <TableScroll label={label}>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">Value</th>
            <th scope="col">Definition</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </TableScroll>
  );
}

// A06 business metrics - Figma "D · Admin desktop · Reports and exports". for support/finance/superadmin with TOTP. Aggregates only (no names, contacts or locations).
// Money appears for finance roles only, and collected money is never presented as revenue.
export default async function AdminMetricsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; venue_id?: string }> }) {
  const gate = await gatePortal("/admin/metrics", (me) => me.platform_roles.length > 0);
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const query = await searchParams;
  const today = venueLocalDate();
  const to = query.to && DATE.test(query.to) ? query.to : today;
  const from = query.from && DATE.test(query.from) ? query.from : venueLocalDate(330, Date.parse(`${to}T00:00:00Z`) - 6 * 86_400_000);
  const venueId = query.venue_id && UUID.test(query.venue_id) ? query.venue_id : undefined;
  let problem: string | null = null;
  const m = await asUser(getDb(), gate.identity.claims, (tx) => adminBusinessMetrics(tx, { from, to, venue_id: venueId })).catch((error: unknown) => {
    if (error instanceof DomainError && (error.code === "VALIDATION_FAILED" || error.code === "NOT_FOUND")) {
      problem = error.code === "NOT_FOUND" ? "That venue was not found." : "Choose a period of at most 92 days, with the start before the end.";
      return null;
    }
    throw error;
  });

  return (
    <main>
      <AdminNav roles={gate.me.platform_roles} active="/admin/metrics" />
      <h1>Metrics</h1>
      <p className="lede page-lede">Useful numbers, defined clearly · Reports for IST calendar days{venueId ? " · one venue" : " · all venues"} · Synthetic test data</p>
      <form className="admin-filter page-lede" method="get" action="/admin/metrics" aria-label="Metrics period">
        <div className="field">
          <label className="field-label" htmlFor="m-from">
            From
          </label>
          <input id="m-from" className="input" type="date" name="from" defaultValue={from} required />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="m-to">
            To
          </label>
          <input id="m-to" className="input" type="date" name="to" defaultValue={to} max={today} required />
        </div>
        <div className="field">
          <span className="field-label" id="m-tz">
            Timezone / currency
          </span>
          <p className="input input-static" aria-labelledby="m-tz">
            Asia/Kolkata · INR
          </p>
        </div>
        {venueId ? <input type="hidden" name="venue_id" value={venueId} /> : null}
        <Button variant="secondary" type="submit">
          Show
        </Button>
      </form>
      {problem ? <p className="book-when status-error" role="alert">{problem}</p> : null}
      {m ? (
        <div className="partner-layout">
          <div className="book-main">
          <div className="panel-row">
            <Card className="book-card" aria-labelledby="k1">
              <h2 id="k1">Paid bookings</h2>
              <p className="kpi-figure">{m.funnel.paid}</p>
              <p className="book-note">Of {m.funnel.holds} holds created in the period.</p>
            </Card>
            <Card className="book-card" aria-labelledby="k2">
              <h2 id="k2">Paid occupancy</h2>
              <p className="kpi-figure">{pct(m.occupancy.booked_minutes, m.occupancy.open_minutes)}</p>
              <p className="book-note">
                {Math.round(m.occupancy.booked_minutes / 60)} of {Math.round(m.occupancy.open_minutes / 60)} table-hours.
              </p>
            </Card>
            <Card className="book-card" aria-labelledby="k3">
              <h2 id="k3">Repeat customers</h2>
              <p className="kpi-figure">{pct(m.repeat.repeat_customers, m.repeat.customers)}</p>
              <p className="book-note">
                {m.repeat.repeat_customers} of {m.repeat.customers} customers.
              </p>
            </Card>
          </div>
          <Card className="book-card" aria-labelledby="funnel-heading" data-testid="metrics-funnel">
            <h2 id="funnel-heading">Bookings</h2>
            <KpiTable label="Metric definitions">
              <Metric label="Conversion" value={`${pct(m.funnel.paid, m.funnel.holds)} (${m.funnel.paid} of ${m.funnel.holds} holds)`}
                definition={METRIC_DEFINITIONS.conversion} testId="metric-conversion" />
              <Metric label="Expired unpaid" value={String(m.funnel.expired_unpaid)} definition={METRIC_DEFINITIONS.expired_unpaid} />
              <Metric label="No-show rate" value={`${pct(m.outcomes.no_show, m.outcomes.paid_bookings)} (${m.outcomes.no_show} of ${m.outcomes.paid_bookings})`}
                definition={METRIC_DEFINITIONS.no_show_rate} />
              <Metric label="Cancelled" value={`${m.outcomes.customer_cancelled} by customers, ${m.outcomes.service_cancelled} by venue or Simply Sit`}
                definition={METRIC_DEFINITIONS.cancellations} />
              <Metric label="Occupancy" value={`${pct(m.occupancy.booked_minutes, m.occupancy.open_minutes)} (${Math.round(m.occupancy.booked_minutes / 60)} of ${Math.round(m.occupancy.open_minutes / 60)} table-hours)`}
                definition={METRIC_DEFINITIONS.occupancy} testId="metric-occupancy" />
              <Metric label="Repeat customers" value={`${pct(m.repeat.repeat_customers, m.repeat.customers)} (${m.repeat.repeat_customers} of ${m.repeat.customers})`}
                definition={METRIC_DEFINITIONS.repeat} />
            </KpiTable>
          </Card>
          <Card className="book-card" aria-labelledby="rel-heading">
            <h2 id="rel-heading">Reliability</h2>
            <KpiTable label="Metric definitions">
              <Metric label="Extensions decided in time"
                value={`${pct(m.reliability.extensions_decided_in_time, m.reliability.extension_requests)} (${m.reliability.extensions_decided_in_time} of ${m.reliability.extension_requests}; ${m.reliability.extensions_applied} applied)`}
                definition={METRIC_DEFINITIONS.extensions_in_time} />
              <Metric label="Refunds"
                value={`${m.reliability.refunds_processed} of ${m.reliability.refunds_requested} completed, ${m.reliability.refunds_failed_or_unknown} failed or unknown${m.reliability.median_refund_minutes === null ? "" : `, median ${m.reliability.median_refund_minutes} min`}`}
                definition={METRIC_DEFINITIONS.refunds} />
              <Metric label="Check-in failures" value={`${pct(m.reliability.check_in_failures, m.reliability.check_in_attempts)} (${m.reliability.check_in_failures} of ${m.reliability.check_in_attempts})`}
                definition={METRIC_DEFINITIONS.check_in_failures} />
              <Metric label="End reminders" value={String(m.reliability.end_reminders)} definition={METRIC_DEFINITIONS.end_reminders} />
            </KpiTable>
          </Card>
          {m.finance ? (
            <Card className="book-card" aria-labelledby="money-heading" data-testid="metrics-finance">
              <h2 id="money-heading">Money</h2>
              {m.finance.reconciliation !== "MATCHED" ? (
                <p className="book-when status-warning" role="note">
                  Not reconciled for the whole period ({m.finance.reconciliation.toLowerCase()}). Treat these figures as unconfirmed.
                </p>
              ) : null}
              <KpiTable label="Metric definitions">
                <Metric label="Collected (not revenue)" value={formatInrPaise(m.finance.collected_paise)} definition={METRIC_DEFINITIONS.collected} />
                <Metric label="Refunded" value={formatInrPaise(m.finance.refunded_paise)} definition={METRIC_DEFINITIONS.refunds} />
                <Metric label="Earned by finished bookings"
                  value={`${formatInrPaise(m.finance.earned_gross_paise)} (partners ${formatInrPaise(m.finance.partner_earned_paise)}, platform fees ${formatInrPaise(m.finance.platform_fee_paise)})`}
                  definition={METRIC_DEFINITIONS.earned} />
                <Metric label="Reconciliation" value={m.finance.reconciliation.toLowerCase()} definition={METRIC_DEFINITIONS.reconciliation} />
              </KpiTable>
            </Card>
          ) : null}
          </div>
          <div className="book-side">
            <Card className="book-card" aria-labelledby="export-heading">
              <h2 id="export-heading">Exports</h2>
              <StatusPill tone="sage">Aggregates only · No personal data</StatusPill>
              <p className="book-when">
                Partner statements export as CSV from each venue’s earnings page. A marketplace-wide export is not available yet.
              </p>
              <p className="field-hint">Any future export will be permission-checked, logged and limited to masked identifiers.</p>
            </Card>
            <div className="notice info">
              <Info size={20} aria-hidden="true" />
              <div>
                <strong>Dates describe different ledgers</strong>
                <p>Booking-created dates, stay dates and settlement periods are distinct. Collected money is never shown as revenue.</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
