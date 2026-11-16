import { notFound } from "next/navigation";
import { adminReconciliationRun, asUser, DomainError, getDb } from "@simply-sit/db";
import { formatInrPaise, formatVenueDateTime } from "../../../../../lib/format";
import { gatePortal, PortalBlocked } from "../../../../../lib/portal-page";
import { TableScroll } from "../../../../../lib/table-scroll";
import { AdminNav } from "../../../../../lib/admin-nav";

export const dynamic = "force-dynamic";

const KIND_TEXT: Record<string, string> = {
  MISSING_LOCALLY: "The provider has it; we have no matching record",
  MISSING_AT_PROVIDER: "We recorded it; the provider does not have it",
  AMOUNT_MISMATCH: "Amounts differ",
  STATE_MISMATCH: "The provider completed it; our record is not complete",
  LEDGER_MISSING: "Recorded without its ledger entry"
};

// A05 reconciliation exceptions. Each one stays visible here; payouts covering the period stay blocked until a later
// run matches.
export default async function ReconciliationRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const gate = await gatePortal(`/admin/finance/reconciliation/${id}`, (me) => me.platform_roles.some((r) => r === "SUPERADMIN" || r === "FINANCE"));
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const run = await asUser(getDb(), gate.identity.claims, (tx) => adminReconciliationRun(tx, id)).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  return (
    <main>
      <p>
        <a href="/admin/finance">Finance</a>
      </p>
      <AdminNav roles={gate.me.platform_roles} active="/admin/finance" />
      <h1>Reconciliation {run.status.toLowerCase()}</h1>
      <p>
        {formatVenueDateTime(run.period_from)} - {formatVenueDateTime(run.period_to)} IST · {run.exception_count} {run.exception_count === 1 ? "exception" : "exceptions"}
        {run.exception_count > run.exceptions.length ? ` (first ${run.exceptions.length} shown)` : ""}
      </p>
      <TableScroll label="Reconciliation exceptions">
        <table className="data-table" data-testid="reconciliation-exceptions">
          <thead>
            <tr><th scope="col">Problem</th><th scope="col">Type</th><th scope="col">Provider reference</th><th scope="col">Booking</th><th scope="col">Provider</th><th scope="col">Ours</th></tr>
          </thead>
          <tbody>
            {run.exceptions.map((x, i) => (
              <tr key={i}>
                <td>{KIND_TEXT[x.kind] ?? x.kind}</td>
                <td>{x.object_type.toLowerCase()}</td>
                <td>{x.provider_ref ?? "-"}</td>
                <td>{x.booking_id ? <a href={`/admin/bookings/${x.booking_id}`}>{x.public_ref}</a> : "-"}</td>
                <td>{x.provider_amount_paise === null ? "-" : formatInrPaise(x.provider_amount_paise)}</td>
                <td>{x.local_amount_paise === null ? "-" : formatInrPaise(x.local_amount_paise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </main>
  );
}
