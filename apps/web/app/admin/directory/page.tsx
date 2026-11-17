import { Search } from "lucide-react";
import { asUser, getDb } from "@simply-sit/db";
import { AdminNav } from "../../../lib/admin-nav";
import { formatVenueDateTime } from "../../../lib/format";
import { gatePortal, PortalBlocked } from "../../../lib/portal-page";
import { TableScroll } from "../../../lib/table-scroll";
import { Button, Card, EmptyState, StatusPill, type PillTone } from "../../../components/ui";

export const dynamic = "force-dynamic";

interface VenueRow {
  id: string;
  slug: string;
  name: string;
  locality: string;
  status: string;
  is_synthetic: boolean;
  tables: number;
  seats: number;
  updated_at: string;
}

const STATES: [string, string][] = [["", "All listing states"], ["PUBLISHED", "Published"], ["PENDING_REVIEW", "In review"], ["DRAFT", "Not yet published"]];
const STATE_VIEW: Record<string, { label: string; tone: PillTone }> = {
  PUBLISHED: { label: "Published", tone: "success" },
  PENDING_REVIEW: { label: "In review", tone: "warm" },
  DRAFT: { label: "Not yet published", tone: "neutral" }
};
const PAGE = 100;

// Figma "Admin · Partner and venue management" (94:20344): every venue with its listing state, searchable. Read-only:
// listing decisions are made on the review page, where the reason is recorded and audited. There is no "pause listing"
// action here because no audited pause-with-impact-review flow exists yet (use the release switch for a marketplace pause).
export default async function AdminDirectoryPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const gate = await gatePortal("/admin/directory", (me) => me.platform_roles.some((r) => r === "SUPERADMIN" || r === "SUPPORT"));
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const status = STATES.some(([s]) => s === sp.status) ? sp.status! : "";
  // Escape LIKE wildcards so a search for "50%" or "a_b" matches those characters literally.
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const { rows, total } = await asUser(getDb(), gate.identity.claims, async (tx) => {
    const rows = await tx<VenueRow[]>`
      select v.id::text, v.slug, v.name, v.locality, v.status, v.is_synthetic, v.updated_at::text,
             (select count(*)::int from public.resources r where r.venue_id = v.id) as tables,
             (select coalesce(sum(r.capacity), 0)::int from public.resources r where r.venue_id = v.id) as seats
      from public.venues v
      where (${q} = '' or v.name ilike ${like} or v.slug ilike ${like} or v.locality ilike ${like})
        and (${status} = '' or v.status = ${status})
      order by v.updated_at desc
      limit ${PAGE}`;
    const [count] = await tx<{ n: number }[]>`
      select count(*)::int as n from public.venues v
      where (${q} = '' or v.name ilike ${like} or v.slug ilike ${like} or v.locality ilike ${like})
        and (${status} = '' or v.status = ${status})`;
    return { rows, total: count?.n ?? rows.length };
  });

  return (
    <main>
      <AdminNav roles={gate.me.platform_roles} active="/admin/directory" />
      <h1>Partner and venue management</h1>
      <p className="lede">Venue directory · every listing and its state. Decisions and their reasons are recorded on the review page.</p>
      <Card style={{ marginTop: 16 }} aria-label="Find a venue">
        <form method="get" className="admin-filter">
          <div className="field">
            <label className="field-label" htmlFor="dir-q">
              Search
            </label>
            <div className="field-control compact">
              <Search size={18} aria-hidden="true" />
              <input id="dir-q" name="q" defaultValue={q} placeholder="Venue name, ID or area" maxLength={80} />
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="dir-status">
              Status
            </label>
            <select id="dir-status" name="status" className="input" defaultValue={status}>
              {STATES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit">Search</Button>
        </form>
      </Card>
      <Card className="flush" style={{ marginTop: 16 }} aria-label="Venues">
        {rows.length === 0 ? (
          <EmptyState title="No venues match" description="Try a different name, area or listing state." />
        ) : (
          <TableScroll label="Venue directory">
            <table data-testid="venue-directory">
              <thead>
                <tr>
                  <th scope="col">Venue / ID</th>
                  <th scope="col">Area</th>
                  <th scope="col">State</th>
                  <th scope="col">Tables</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const view = STATE_VIEW[v.status] ?? { label: v.status.replaceAll("_", " ").toLowerCase(), tone: "neutral" as const };
                  return (
                    <tr key={v.id}>
                      <td>
                        <span className="cell-strong">{v.name}</span>
                        <br />
                        <span className="muted small">
                          {v.slug}
                          {v.is_synthetic ? " · synthetic" : ""}
                        </span>
                      </td>
                      <td>{v.locality}</td>
                      <td>
                        <StatusPill tone={view.tone}>{view.label}</StatusPill>
                      </td>
                      <td>
                        {v.tables} / {v.seats} seats
                      </td>
                      <td>{formatVenueDateTime(v.updated_at)} IST</td>
                      <td>
                        <a className="row-action" href={`/admin/venues/${v.id}`}>
                          Open partner record
                        </a>
                        {v.status === "PUBLISHED" ? (
                          <>
                            {" · "}
                            <a className="row-action" href={`/venues/${v.slug}`}>
                              Public page
                            </a>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
        <p className="table-footer">
          Showing {rows.length} of {total} {total === 1 ? "venue" : "venues"}
          {total > rows.length ? " (most recently updated first; narrow the search to see others)" : ""}.
        </p>
      </Card>
    </main>
  );
}
