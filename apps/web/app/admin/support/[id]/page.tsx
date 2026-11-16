import { notFound } from "next/navigation";
import { TICKET_CATEGORY_LABEL } from "@simply-sit/contracts";
import { adminTicketDetail, asUser, DomainError, getDb } from "@simply-sit/db";
import { formatVenueDateTime } from "../../../../lib/format";
import { gatePortal, PortalBlocked } from "../../../../lib/portal-page";
import { TicketTriage, type AdminTicket } from "./ticket-triage";
import { AdminNav } from "../../../../lib/admin-nav";
import { Card } from "../../../../components/ui";

export const dynamic = "force-dynamic";

// A04 - ticket detail: the report, private notes, triage and the customer-visible reply. Contact details are revealed
// only on request with a reason (audited). Confidential tickets: superadmins and the assigned admin only.
export default async function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const gate = await gatePortal(`/admin/support/${id}`, (me) => me.platform_roles.some((r) => r === "SUPERADMIN" || r === "SUPPORT"));
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const ticket = (await asUser(getDb(), gate.identity.claims, (tx) => adminTicketDetail(tx, id)).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  })) as AdminTicket;
  return (
    <main>
      <p>
        <a href="/admin/support">Support</a>
      </p>
      <AdminNav roles={gate.me.platform_roles} active="/admin/support" />
      <h1>
        {ticket.public_ref} {ticket.is_sensitive ? <span className="badge">Confidential</span> : null}
      </h1>
      <p data-testid="admin-ticket-status">
        {ticket.status.replace("_", " ").toLowerCase()} · {ticket.priority.toLowerCase()} priority · {ticket.assigned ? (ticket.assigned_to_me ? "assigned to you" : "assigned") : "unassigned"}
      </p>
      <Card aria-labelledby="report-heading">
        <h2 id="report-heading">{TICKET_CATEGORY_LABEL[ticket.category]}</h2>
        <p className="food-note">
          From {ticket.reporter_role === "VENUE_STAFF" ? "venue staff" : "a customer"} · {formatVenueDateTime(ticket.created_at)} IST
          {ticket.venue_name ? ` · ${ticket.venue_name}` : ""}
          {ticket.booking_ref && ticket.booking_id ? (
            <>
              {" "}· booking <a href={`/admin/bookings/${ticket.booking_id}`}>{ticket.booking_ref}</a>
            </>
          ) : null}
        </p>
        <p>{ticket.description}</p>
      </Card>
      <TicketTriage ticket={ticket} />
    </main>
  );
}
