"use client";

// Figma "Create a linked support ticket": associated booking, category and description. Replies arrive on the ticket.
import { useState, type FormEvent } from "react";
import { TICKET_CATEGORIES, TICKET_CATEGORY_LABEL, type Ticket } from "@simply-sit/contracts";
import { useAction } from "../../lib/use-action";

export function SupportForm({ bookings }: { bookings: { id: string; label: string }[] }) {
  const action = useAction();
  const [category, setCategory] = useState<(typeof TICKET_CATEGORIES)[number]>("BOOKING");
  const [booking, setBooking] = useState("");
  const [description, setDescription] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await action.run<Ticket>("ticket", "POST", "/api/v1/support-tickets",
      { category, description, ...(booking ? { booking_id: booking } : {}) }, { idempotent: true, refresh: false });
    if (result.ok) window.location.assign(`/support/${result.data.ticket_id}`);
  }

  return (
    <form className="card book-card" onSubmit={(e) => void submit(e)} aria-labelledby="contact-heading">
      <h2 id="contact-heading">Create a linked support ticket</h2>
      <div className="field">
        <label className="field-label" htmlFor="t-booking">
          Associated booking
        </label>
        <select id="t-booking" className="input" value={booking} onChange={(e) => setBooking(e.target.value)} data-testid="ticket-booking">
          <option value="">Not about a booking</option>
          {bookings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field-pair">
        <div className="field">
          <label className="field-label" htmlFor="t-category">
            Category
          </label>
          <select id="t-category" className="input" value={category} onChange={(e) => setCategory(e.target.value as typeof category)} data-testid="ticket-category">
            {TICKET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {TICKET_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="field-label" id="t-reply-label">
            Reply via
          </span>
          <p className="input input-static" aria-labelledby="t-reply-label">
            Case conversation + email
          </p>
        </div>
      </div>
      {category === "SAFETY" ? <p className="field-hint">Safety reports are confidential: only senior support staff can read them.</p> : null}
      <div className="field">
        <label className="field-label" htmlFor="t-description">
          Description
        </label>
        <textarea id="t-description" className="input" rows={4} required minLength={10} maxLength={5000} value={description}
          placeholder="Tell us what happened. Include your booking ID, never a PIN or OTP." onChange={(e) => setDescription(e.target.value)}
          data-testid="ticket-description" />
      </div>
      {action.message ? (
        <p className={`book-when status-${action.message.tone}`} role="alert">
          {action.message.text}
        </p>
      ) : null}
      <button className="button" type="submit" disabled={action.busy !== null} data-testid="ticket-submit">
        {action.busy ? "Sending…" : "Submit support ticket"}
      </button>
    </form>
  );
}
