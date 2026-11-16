"use client";

// Figma "C · Partner desktop · Report incident": incident context and description. Submitting creates a support case;
// it never cancels the booking, moves the guest or issues a refund. Evidence uploads are not supported yet.
import { useState, type FormEvent } from "react";
import { TICKET_CATEGORIES, TICKET_CATEGORY_LABEL } from "@simply-sit/contracts";
import { useAction } from "../../../../lib/use-action";

type Props = { venueId: string; booking: { booking_id: string; public_ref: string; resource_label: string } | null };

export function IncidentForm({ venueId, booking }: Props) {
  const action = useAction();
  const [category, setCategory] = useState<(typeof TICKET_CATEGORIES)[number]>("VENUE");
  const [what, setWhat] = useState("");
  const [taken, setTaken] = useState("");
  const [sensitive, setSensitive] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const description = taken.trim() ? `${what.trim()}\n\nAction taken: ${taken.trim()}` : what.trim();
    const result = await action.run("incident", "POST", "/api/v1/partner/incidents", {
      venue_id: venueId, ...(booking ? { booking_id: booking.booking_id } : {}), category, description, sensitive: sensitive || category === "SAFETY"
    }, { idempotent: true, success: "Reported to Simply Sit support. A case has been created." });
    if (result.ok) {
      setWhat("");
      setTaken("");
    }
  }

  return (
    <form className="book-main" onSubmit={(e) => void submit(e)}>
      <section className="card book-card" aria-labelledby="context-heading">
        <h2 id="context-heading">Incident context</h2>
        <div className="field-pair">
          <div className="field">
            <span className="field-label" id="linked-label">
              Linked booking
            </span>
            <p className="input input-static" aria-labelledby="linked-label">
              {booking ? booking.public_ref : "Not about a booking"}
            </p>
          </div>
          <div className="field">
            <span className="field-label" id="table-label">
              Table
            </span>
            <p className="input input-static" aria-labelledby="table-label">
              {booking ? booking.resource_label : "—"}
            </p>
          </div>
        </div>
        <div className="field-pair">
          <div className="field">
            <label className="field-label" htmlFor="inc-category">
              Category
            </label>
            <select id="inc-category" className="input" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
              {TICKET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {TICKET_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="field-label">Confidentiality</span>
            <label className="check-row input input-static">
              <input type="checkbox" checked={sensitive || category === "SAFETY"} disabled={category === "SAFETY"} onChange={(e) => setSensitive(e.target.checked)} />
              <span>Confidential · senior support only</span>
            </label>
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="inc-text">
            What happened?
          </label>
          <textarea id="inc-text" className="input" rows={4} required minLength={10} maxLength={4000} value={what} onChange={(e) => setWhat(e.target.value)}
            placeholder="Include the time it happened (IST). Use the booking reference, not guest contact details." data-testid="incident-text" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="inc-taken">
            Action taken
          </label>
          <input id="inc-taken" className="input" maxLength={800} value={taken} onChange={(e) => setTaken(e.target.value)} placeholder="e.g. Socket taken out of use" />
        </div>
        <p className="field-hint">Do not include identity documents, payment details or personal contact details.</p>
      </section>
      {action.message ? (
        <p className={`book-when status-${action.message.tone}`} role="status">
          {action.message.text}
        </p>
      ) : null}
      <button className="button" type="submit" disabled={action.busy !== null} data-testid="incident-submit">
        {action.busy ? "Sending…" : "Submit incident report"}
      </button>
      <p className="book-note">Submission creates a case; it does not cancel the booking, move the guest or issue a refund.</p>
    </form>
  );
}
