import { asUser, getDb } from "@simply-sit/db";
import { AdminNav } from "../../../lib/admin-nav";
import { formatVenueDateTime } from "../../../lib/format";
import { gatePortal, PortalBlocked } from "../../../lib/portal-page";
import { TableScroll } from "../../../lib/table-scroll";
import { Badge, EmptyState } from "../../../components/ui";

export const dynamic = "force-dynamic";

interface AdminMembershipRow {
  user_id: string;
  role: string;
  status: string;
  created_at: string;
  display_name: string | null;
}

export default async function AdminUsersPage() {
  const gate = await gatePortal("/admin/users", (me) => me.platform_roles.includes("SUPERADMIN"));
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;

  const rows = await asUser(getDb(), gate.identity.claims, async (tx) => {
    return tx<AdminMembershipRow[]>`
      select pm.user_id::text, pm.role, pm.status, pm.created_at::text, p.display_name
      from public.platform_memberships pm
      left join public.profiles p on p.id = pm.user_id
      order by pm.created_at desc
      limit 100
    `;
  });

  return (
    <main>
      <AdminNav roles={gate.me.platform_roles} active="/admin/users" />
      <h1>Admin users and permissions</h1>
      <p className="lede">Platform role assignments enforced by PostgreSQL row-level security and MFA requirements.</p>
      <section className="card flush" style={{ marginTop: 16 }}>
        {rows.length === 0 ? (
          <EmptyState title="No admin memberships found" description="Platform role assignments will appear here." />
        ) : (
          <TableScroll label="Platform admin memberships">
            <table>
              <thead>
                <tr>
                  <th>Admin</th>
                  <th>User ID</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Assigned (IST)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={`${row.user_id}-${row.role}-${idx}`}>
                    <td>{row.display_name ?? "Platform admin"}</td>
                    <td>
                      <code>{row.user_id.slice(0, 8)}...</code>
                    </td>
                    <td>
                      <Badge tone="sage">{row.role}</Badge>
                    </td>
                    <td>
                      <Badge tone={row.status === "ACTIVE" ? "success" : "neutral"}>{row.status}</Badge>
                    </td>
                    <td>{formatVenueDateTime(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </section>
    </main>
  );
}
