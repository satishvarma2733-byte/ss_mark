// The help and case columns of Figma "E · Customer web · Account and support centre", shared by /help and /account.
import { Info } from "lucide-react";
import { TICKET_CATEGORY_LABEL, type Ticket } from "@simply-sit/contracts";
import { asUser, customerBookings, getDb, myTickets, type VerifiedClaims } from "@simply-sit/db";
import { formatVenueDateTime } from "../../lib/format";
import { HelpTopics } from "./help-topics";
import { SupportForm } from "./support-form";
import { ButtonLink, Card } from "../../components/ui";

type BookingRow = { booking_id: string; public_ref: string; start_at: string; venue: { name: string } };

export async function loadSupportData(claims: VerifiedClaims) {
  return asUser(getDb(), claims, async (tx) => [
    (await myTickets(tx)) as unknown as Ticket[],
    (await customerBookings(tx, "all", 0, 20)).bookings as unknown as BookingRow[]
  ] as const);
}

const OPEN = new Set(["OPEN", "IN_PROGRESS"]);

export function HelpColumn({ bookings, signedIn, redirectPath }: { bookings: BookingRow[]; signedIn: boolean; redirectPath: string }) {
  return (
    <div className="book-main">
      <HelpTopics />
      {signedIn ? (
        <SupportForm bookings={bookings.map((b) => ({ id: b.booking_id, label: `${b.public_ref} · ${b.venue.name} · ${formatVenueDateTime(b.start_at)}` }))} />
      ) : (
        <Card className="book-card" aria-labelledby="contact-heading">
          <h2 id="contact-heading">Create a linked support ticket</h2>
          <p className="book-when">Sign in to raise a ticket linked to your booking and follow the conversation.</p>
          <ButtonLink href={`/sign-in?redirect_path=${encodeURIComponent(redirectPath)}`}>
            Sign in to contact support
          </ButtonLink>
        </Card>
      )}
    </div>
  );
}

export function CasesColumn({ tickets, signedIn }: { tickets: Ticket[]; signedIn: boolean }) {
  return (
    <div className="book-side">
      {signedIn ? (
        <Card className="book-card" aria-labelledby="tickets-heading">
          <h2 id="tickets-heading">Your cases</h2>
          {tickets.length === 0 ? (
            <p className="book-note">No cases yet. Tickets you raise appear here with their status.</p>
          ) : (
            <ul className="case-list" data-testid="my-tickets">
              {tickets.map((t) => (
                <li key={t.ticket_id}>
                  <span className={`status-pill ${OPEN.has(t.status) ? "warm" : "neutral"}`}>{t.status.replaceAll("_", " ").toLowerCase()}</span>
                  <a className="case-title" href={`/support/${t.ticket_id}`}>
                    {t.public_ref} · {TICKET_CATEGORY_LABEL[t.category]}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
      <div className="notice info">
        <Info size={20} aria-hidden="true" />
        <div>
          <strong>We’ll never ask for secrets</strong>
          <p>No UPI PIN, OTP, password or full bank details belong in a support ticket. Booking and case references are enough to begin.</p>
        </div>
      </div>
    </div>
  );
}
