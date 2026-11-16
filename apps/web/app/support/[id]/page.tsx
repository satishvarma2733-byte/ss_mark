import { notFound, redirect } from "next/navigation";
import { TICKET_CATEGORY_LABEL, type Ticket } from "@simply-sit/contracts";
import { asUser, DomainError, getDb, myTicket } from "@simply-sit/db";
import { resolveIdentity } from "../../../lib/auth/identity";
import { formatVenueDateTime } from "../../../lib/format";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  OPEN: "Received - support will look at it", IN_PROGRESS: "Support is working on it", RESOLVED: "Resolved", CLOSED: "Closed"
};

// C13 ticket - the reporter's own request and the reply from support. Private investigation notes are never shown.
export default async function SupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const identity = await resolveIdentity();
  if (identity.kind !== "user") redirect(`/sign-in?redirect_path=${encodeURIComponent(`/support/${id}`)}`);
  const ticket = (await asUser(getDb(), identity.claims, (tx) => myTicket(tx, id)).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  })) as Ticket;
  return (
    <main>
      <p>
        <a href="/help">Help</a>
      </p>
      <h1>Request {ticket.public_ref}</h1>
      <p data-testid="ticket-status">
        <strong>{STATUS[ticket.status] ?? ticket.status}</strong>
      </p>
      <section className="card" aria-labelledby="t-heading">
        <h2 id="t-heading">{TICKET_CATEGORY_LABEL[ticket.category]}</h2>
        <p className="food-note">
          Sent {formatVenueDateTime(ticket.created_at)} IST{ticket.booking_ref ? ` · booking ${ticket.booking_ref}` : ""}
          {ticket.is_sensitive ? " · confidential" : ""}
        </p>
        <p>{ticket.description}</p>
      </section>
      {ticket.customer_visible_resolution ? (
        <section className="card" style={{ marginTop: 16 }} aria-labelledby="r-heading" data-testid="ticket-resolution">
          <h2 id="r-heading">Reply from Simply Sit</h2>
          <p>{ticket.customer_visible_resolution}</p>
        </section>
      ) : null}
    </main>
  );
}
