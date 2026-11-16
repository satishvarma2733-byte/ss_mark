import { asUser, getDb } from "@simply-sit/db";
import { AdminNav } from "../../../lib/admin-nav";
import { formatVenueDateTime } from "../../../lib/format";
import { gatePortal, PortalBlocked } from "../../../lib/portal-page";
import { TableScroll } from "../../../lib/table-scroll";
import { Badge, Card, EmptyState } from "../../../components/ui";

export const dynamic = "force-dynamic";

interface AuditRow {
  id: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  reason: string | null;
  created_at: string;
}

export default async function AdminAuditPage() {
  const gate = await gatePortal("/admin/audit", (me) => me.platform_roles.length > 0);
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;

  const rows = await asUser(getDb(), gate.identity.claims, async (tx) => {
    const res = await tx<AuditRow[]>`
      select id::text, actor_role, action, entity_type, entity_id::text, reason, created_at::text
      from public.audit_events
      order by created_at desc
      limit 100
    `;
    return res;
  });

  return (
    <main>
      <AdminNav roles={gate.me.platform_roles} active="/admin/audit" />
      <h1>Audit log</h1>
      <p className="lede">Append-only record of sensitive platform, booking, payment, and release actions (latest 100 events).</p>
      <Card className="flush" style={{ marginTop: 16 }}>
        {rows.length === 0 ? (
          <EmptyState title="No audit events yet" description="Sensitive operations will appear here automatically." />
        ) : (
          <TableScroll label="Audit events">
            <table>
              <thead>
                <tr>
                  <th>Time (IST)</th>
                  <th>Action</th>
                  <th>Actor role</th>
                  <th>Entity</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatVenueDateTime(row.created_at)}</td>
                    <td>
                      <code>{row.action}</code>
                    </td>
                    <td>
                      <Badge tone="neutral">{row.actor_role}</Badge>
                    </td>
                    <td>
                      {row.entity_type}
                      {row.entity_id ? <small className="food-note"> ({row.entity_id.slice(0, 8)}...)</small> : null}
                    </td>
                    <td>{row.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>
    </main>
  );
}
