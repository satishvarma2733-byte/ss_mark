import { Clock3 } from "lucide-react";
import { EMERGENCY_NUMBER, TICKET_CATEGORY_LABEL, type Ticket } from "@simply-sit/contracts";
import { adminTicketQueue, asUser, getDb } from "@simply-sit/db";
import { formatVenueDateTime } from "../../../lib/format";
import { gatePortal, PortalBlocked } from "../../../lib/portal-page";
import { TableScroll } from "../../../lib/table-scroll";
import { AdminNav } from "../../../lib/admin-nav";
import { Button, Card, StatusPill } from "../../../components/ui";

export const dynamic = "force-dynamic";

const STATUSES = [["OPEN", "Open"], ["IN_PROGRESS", "In progress"], ["RESOLVED", "Resolved"], ["CLOSED", "Closed"]] as const;
const PRIORITY_ORDER: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2 };
type Row = Ticket & { reporter_role: string; assigned_to_me: boolean };

// A04 queue - Figma "D · Admin desktop · Support and safety incidents". Support/superadmin with TOTP. Confidential
// tickets the caller may not open are only counted. Urgent and safety cases sort first.
export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; urgent?: string }> }) {
  const gate = await gatePortal("/admin/support", (me) => me.platform_roles.some((r) => r === "SUPERADMIN" || r === "SUPPORT"));
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const sp = await searchParams;
  const status = STATUSES.some(([s]) => s === sp.status) ? sp.status! : "OPEN";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const urgentOnly = sp.urgent === "1";
  const queue = (await asUser(getDb(), gate.identity.claims, (tx) => adminTicketQueue(tx, status))) as { tickets: Row[]; restricted_count: number };
  const needle = q.toLowerCase();
  const tickets = queue.tickets
    .filter((t) => !urgentOnly || t.priority === "URGENT" || t.category === "SAFETY")
    .filter((t) => !needle || [t.public_ref, t.booking_ref ?? "", t.venue_name ?? ""].some((v) => v.toLowerCase().includes(needle)))
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3) || Date.parse(a.created_at) - Date.parse(b.created_at));
  const urgentCount = queue.tickets.filter((t) => t.priority === "URGENT" || t.category === "SAFETY").length;
  const href = (s: string, urgent: boolean) => `/admin/support?status=${s}${urgent ? "&urgent=1" : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <main>
      <AdminNav roles={gate.me.platform_roles} active="/admin/support" />
      <h1>Care first. Clear next steps.</h1>
      <p className="lede page-lede">
        Trust &amp; support · {queue.tickets.length} {STATUSES.find(([s]) => s === status)![1].toLowerCase()} · {urgentCount} urgent or safety
      </p>
      <form className="admin-filter page-lede" method="get" action="/admin/support" aria-label="Find a case">
        <input type="hidden" name="status" value={status} />
        {urgentOnly ? <input type="hidden" name="urgent" value="1" /> : null}
        <div className="field">
          <label className="field-label" htmlFor="case-q">
            Search case / booking
          </label>
          <input id="case-q" name="q" className="input" defaultValue={q} placeholder="Case ID, venue or booking" />
        </div>
        <Button variant="secondary" type="submit">
          Search
        </Button>
      </form>
      <nav aria-label="Case filters" className="page-lede">
        <ul className="choice-pills">
          {STATUSES.map(([s, label]) => (
            <li key={s}>
              <a className={`choice-pill${s === status && !urgentOnly ? " selected" : ""}`} href={href(s, false)} aria-current={s === status && !urgentOnly ? "page" : undefined}>
                {label}
              </a>
            </li>
          ))}
          <li>
            <a className={`choice-pill${urgentOnly ? " selected" : ""}`} href={href(status, true)} aria-current={urgentOnly ? "page" : undefined}>
              Urgent &amp; safety · {urgentCount}
            </a>
          </li>
        </ul>
      </nav>

      <div className="partner-layout">
        <Card className="book-card" aria-labelledby="backlog-heading">
          <h2 id="backlog-heading">Prioritised backlog</h2>
          {queue.restricted_count > 0 ? (
            <p className="book-note" data-testid="restricted-count">
              {queue.restricted_count} confidential ticket(s) are assigned to other admins and hidden from you.
            </p>
          ) : null}
          {tickets.length === 0 ? (
            <p className="book-note">No tickets.</p>
          ) : (
            <TableScroll label="Support requests">
              <table data-testid="ticket-queue">
                <thead>
                  <tr>
                    <th scope="col">Case</th>
                    <th scope="col">Priority / type</th>
                    <th scope="col">Booking context</th>
                    <th scope="col">From</th>
                    <th scope="col">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <tr key={t.ticket_id} className={t.priority === "URGENT" ? "row-highlight" : undefined}>
                      <th scope="row">
                        <a href={`/admin/support/${t.ticket_id}`}>{t.public_ref}</a>
                        {t.is_sensitive ? <StatusPill className="table-pill" tone="danger">Confidential</StatusPill> : null}
                        {t.assigned_to_me ? " (yours)" : ""}
                      </th>
                      <td>
                        {t.priority.charAt(0) + t.priority.slice(1).toLowerCase()} · {TICKET_CATEGORY_LABEL[t.category]}
                      </td>
                      <td>{t.booking_ref ?? "No booking"}</td>
                      <td>{t.reporter_role === "VENUE_STAFF" ? `Venue staff · ${t.venue_name ?? ""}` : "Customer"}</td>
                      <td>{formatVenueDateTime(t.created_at)} IST</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
          <p className="book-note">Urgent cases sort first. Prioritise imminent arrivals and immediate safety needs.</p>
        </Card>

        <div className="book-side">
          <div className="notice warm">
            <Clock3 size={20} aria-hidden="true" />
            <div>
              <strong>Immediate safety risk</strong>
              <p>Direct people to local emergency services ({EMERGENCY_NUMBER}) and the on-call safety lead. A support queue must not delay emergency action.</p>
            </div>
          </div>
          <Card className="book-card" aria-labelledby="roles-heading">
            <h2 id="roles-heading">Role-controlled actions</h2>
            <dl className="detail-rows">
              <div>
                <dt>Reply / assign</dt>
                <dd>Support allowed</dd>
              </div>
              <div>
                <dt>Release switches</dt>
                <dd>Reason + impact review</dd>
              </div>
              <div>
                <dt>Refund / settlement</dt>
                <dd>Finance admin only</dd>
              </div>
            </dl>
            <p className="field-hint">Pausing new sales never silently cancels confirmed stays. Review affected bookings and record the resolution separately.</p>
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
