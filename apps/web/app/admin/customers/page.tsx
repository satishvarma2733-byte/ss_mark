import { asUser, getDb } from "@simply-sit/db";
import { AdminNav } from "../../../lib/admin-nav";
import { formatVenueDateTime } from "../../../lib/format";
import { gatePortal, PortalBlocked } from "../../../lib/portal-page";
import { TableScroll } from "../../../lib/table-scroll";
import { Badge, EmptyState } from "../../../components/ui";

export const dynamic = "force-dynamic";

interface CustomerRow {
  id: string;
  display_name: string | null;
  status: string;
  terms_version: string | null;
  created_at: string;
}

const STATUS_TONE: Record<string, "success" | "warning" | "error" | "neutral"> = {
  ACTIVE: "success",
  SUSPENDED: "error",
  DELETION_PENDING: "warning",
  ANONYMIZED: "neutral"
};

export default async function AdminCustomersPage() {
  const gate = await gatePortal("/admin/customers", (me) =>
    me.platform_roles.some((r) => r === "SUPERADMIN" || r === "SUPPORT")
  );
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;

  const rows = await asUser(getDb(), gate.identity.claims, async (tx) => {
    return tx<CustomerRow[]>`
      select id::text, display_name, status, terms_version, created_at::text
      from public.profiles
      order by created_at desc
      limit 100
    `;
  });

  return (
    <main>
      <AdminNav roles={gate.me.platform_roles} active="/admin/customers" />
      <h1>Customer management</h1>
      <p className="lede">Registered profiles, account status, and terms acceptance (latest 100 profiles).</p>
      <section className="card flush" style={{ marginTop: 16 }}>
        {rows.length === 0 ? (
          <EmptyState title="No customer profiles found" description="Customer profiles appear here after sign-in." />
        ) : (
          <TableScroll label="Customer profiles">
            <table>
              <thead>
                <tr>
                  <th>Display name</th>
                  <th>Profile ID</th>
                  <th>Status</th>
                  <th>Terms version</th>
                  <th>Joined (IST)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.display_name ?? "Unnamed user"}</td>
                    <td>
                      <code>{row.id.slice(0, 8)}...</code>
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.status}</Badge>
                    </td>
                    <td>{row.terms_version ?? "Pending"}</td>
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
