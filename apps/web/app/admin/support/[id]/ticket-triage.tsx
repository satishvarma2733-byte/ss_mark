"use client";

import { useState, type FormEvent } from "react";
import type { Ticket } from "@simply-sit/contracts";
import { formatVenueDateTime } from "../../../../lib/format";
import { useAction } from "../../../../lib/use-action";
import { Button, Card } from "../../../../components/ui";

export type AdminTicket = Ticket & {
  reporter_role: string; booking_id: string | null; assigned_to_me: boolean; assigned: boolean;
  notes: { body: string; at: string; by_me: boolean }[]; support_admins: { profile_id: string; label: string }[] | null;
};

export function TicketTriage({ ticket }: { ticket: AdminTicket }) {
  const update = useAction();
  const reveal = useAction();
  const [status, setStatus] = useState(ticket.status);
  const [priority, setPriority] = useState(ticket.priority);
  const [assignTo, setAssignTo] = useState("");
  const [resolution, setResolution] = useState(ticket.customer_visible_resolution ?? "");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const body: Record<string, unknown> = { expected_version: ticket.version };
    if (status !== ticket.status) body.status = status;
    if (priority !== ticket.priority) body.priority = priority;
    if (assignTo) body.assign_to = assignTo;
    if (resolution.trim() && resolution.trim() !== (ticket.customer_visible_resolution ?? "")) body.customer_visible_resolution = resolution.trim();
    if (note.trim()) body.note = note.trim();
    const result = await update.run("update", "PATCH", `/api/v1/admin/support-tickets/${ticket.ticket_id}`, body, { success: "Saved." });
    if (result.ok) setNote("");
  }

  async function revealContact() {
    const result = await reveal.run<{ email: string | null }>("reveal", "POST", `/api/v1/admin/support-tickets/${ticket.ticket_id}/contact`,
      { reason }, { refresh: false });
    if (result.ok) setEmail(result.data.email ?? "No email on file");
  }

  return (
    <>
      <Card style={{ marginTop: 16 }} aria-labelledby="notes-heading">
        <h2 id="notes-heading">Private notes</h2>
        {ticket.notes.length === 0 ? <p className="food-note">No notes yet. Notes are never shown to the reporter.</p> : (
          <ul data-testid="ticket-notes">
            {ticket.notes.map((n, i) => (
              <li key={i}>
                <span className="food-note">{formatVenueDateTime(n.at)} IST{n.by_me ? " · you" : ""}</span> - {n.body}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <form className="card" style={{ marginTop: 16 }} onSubmit={(e) => void save(e)} aria-labelledby="triage-heading">
        <h2 id="triage-heading">Triage</h2>
        <div className="inline-form">
          <label>
            Status
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} data-testid="ticket-status-select">
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="RESOLVED">Resolved</option>
              <option value="CLOSED">Closed</option>
            </select>
          </label>
          <label>
            Priority
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </label>
          {ticket.support_admins ? (
            <label>
              Assign to
              <select className="input" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                <option value="">No change</option>
                {ticket.support_admins.map((a) => (
                  <option key={a.profile_id} value={a.profile_id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <label htmlFor="resolution">Reply to the reporter (they will see this)</label>
        <textarea id="resolution" className="input" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} data-testid="ticket-resolution-input" />
        <label htmlFor="note">Private note (support only)</label>
        <textarea id="note" className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} data-testid="ticket-note-input" />
        <Button type="submit" disabled={update.busy !== null} data-testid="ticket-save">
          Save
        </Button>
        {update.message ? <p className={`status-${update.message.tone}`} role="status">{update.message.text}</p> : null}
      </form>

      <Card style={{ marginTop: 16 }} aria-labelledby="contact-heading">
        <h2 id="contact-heading">Contact the reporter</h2>
        {email ? <p data-testid="revealed-email">{email}</p> : (
          <>
            <label htmlFor="reveal-reason">Why do you need their email? (recorded)</label>
            <input id="reveal-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} maxLength={500} />
            <Button variant="secondary" type="button" disabled={reveal.busy !== null || reason.trim().length < 10} onClick={() => void revealContact()}>
              Show email
            </Button>
          </>
        )}
        {reveal.message ? <p className={`status-${reveal.message.tone}`} role="status">{reveal.message.text}</p> : null}
      </Card>
    </>
  );
}
