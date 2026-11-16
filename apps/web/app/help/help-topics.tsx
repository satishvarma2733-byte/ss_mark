"use client";

// Figma "How can we help?": a topic search, topic chips and expandable answers. Filtering happens in the browser.
import { useState } from "react";

const TOPICS = ["Bookings", "Payments", "Refunds", "Venue rules"] as const;
type Topic = (typeof TOPICS)[number];

const FAQ: { topic: Topic; q: string; a: string }[] = [
  { topic: "Refunds", q: "Where is my refund?", a: "Refunds go back to the original payment method. Your booking shows the refund as in progress until the payment provider confirms it, then as refunded." },
  { topic: "Payments", q: "Why isn’t my payment a confirmation?", a: "A booking is confirmed only after we verify the payment with the provider. A debit on its own does not reserve a table. If a payment is being verified, do not pay again." },
  { topic: "Bookings", q: "What should I show at reception?", a: "Show the check-in pass on your booking: the QR code or your booking reference and six-digit PIN. Check-in opens 15 minutes before your start." },
  { topic: "Bookings", q: "I am running late.", a: "Venues hold your table for the grace period shown on your booking. After that the booking may be marked as a no-show. Your end time does not move." },
  { topic: "Bookings", q: "Can I stay longer?", a: "While you are checked in, use “Need more time?” on your booking. The venue answers within five minutes and you pay only for the extra time." },
  { topic: "Venue rules", q: "Can I bring my own food?", a: "It depends on the venue. Each venue page and your booking show its food and delivery rules. There is never a compulsory food order." },
  { topic: "Refunds", q: "How much do I get back if I cancel?", a: "The cancellation policy you accepted when booking decides the refund. The cancel screen shows the exact amount before you confirm." }
];

export function HelpTopics() {
  const [topic, setTopic] = useState<Topic | null>(null);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = FAQ.filter((f) => (!topic || f.topic === topic) && (!needle || `${f.q} ${f.a}`.toLowerCase().includes(needle)));

  return (
    <section className="card book-card" aria-labelledby="faq-heading">
      <h2 id="faq-heading">How can we help?</h2>
      <div className="field">
        <label className="field-label" htmlFor="help-search">
          Search help topics
        </label>
        <input id="help-search" className="input" type="search" placeholder="Refunds, check-in, payments…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="choice-pills" role="group" aria-label="Help topics">
        {TOPICS.map((t) => (
          <button key={t} type="button" className={`choice-pill${t === topic ? " selected" : ""}`} aria-pressed={t === topic}
            onClick={() => setTopic(t === topic ? null : t)}>
            {t}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="book-note" role="status">
          No answers match. Try another word, or create a support ticket below.
        </p>
      ) : (
        <div className="faq-list">
          {shown.map((f) => (
            <details key={f.q}>
              <summary>{f.q} →</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
