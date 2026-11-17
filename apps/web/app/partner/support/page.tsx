import { CircleAlert } from "lucide-react";
import { EMERGENCY_NUMBER, TICKET_CATEGORY_LABEL, type Ticket } from "@simply-sit/contracts";
import { asUser, getDb, myTickets } from "@simply-sit/db";
import { formatVenueDateTime } from "../../../lib/format";
import { PartnerNav, partnerContext } from "../../../lib/partner-page";
import { PortalBlocked } from "../../../lib/portal-page";
import { TableScroll } from "../../../lib/table-scroll";
import { ButtonLink, Card, EmptyState, StatusPill } from "../../../components/ui";
import { SupportForm } from "../../help/support-form";

export const dynamic = "force-dynamic";

const STATE: Record<Ticket["status"], { label: string; tone: "warm" | "sage" | "neutral" }> = {
  OPEN: { label: "Awaiting support", tone: "warm" },
  IN_PROGRESS: { label: "In progress", tone: "sage" },
  RESOLVED: { label: "Resolved", tone: "neutral" },
  CLOSED: { label: "Closed", tone: "neutral" }
};

// Figma "Partner · Support centre" (94:18856). The signed-in person's own support cases inside the partner workspace,
// and a form to open a new one. Cases are private to whoever raised them (same rule as /help); nothing here is shared
// between staff, and support never overrides an unpaid or cancelled pass.
export default async function PartnerSupportPage({ searchParams }: { searchParams: Promise<{ venue?: string }> }) {
  const ctx = await partnerContext("/partner/support", (await searchParams).venue);
  if (ctx.state === "blocked") return <PortalBlocked gate={ctx.gate} />;
  if (ctx.state !== "ok") return null;
  const tickets = (await asUser(getDb(), ctx.gate.identity.claims, (tx) => myTickets(tx))) as unknown as Ticket[];
  const q = `?venue=${ctx.current.venue_id}`;
  return (
    <main>
      <h1>Support centre</h1>
      <PartnerNav current={ctx.current} memberships={ctx.memberships} active="/partner/support" />
      <p className="lede page-lede">{ctx.current.venue_name} · How can we help your venue?</p>
      <div className="notice warm" role="note">
        <CircleAlert size={20} aria-hidden="true" />
        <div>
          <strong>In an emergency, call {EMERGENCY_NUMBER}</strong>
          <p>Support cases are not monitored for emergencies. For a problem at the venue right now, report an incident.</p>
        </div>
      </div>
      <div className="ops-columns wide-side">
        <div className="ops-main">
          <Card className="flush" aria-labelledby="cases-heading">
            <div className="card-section">
              <div className="section-heading">
                <h2 id="cases-heading">Your cases</h2>
                <ButtonLink variant="secondary" href={`/partner/incidents/new${q}`}>
                  Report an incident
                </ButtonLink>
              </div>
            </div>
            {tickets.length === 0 ? (
              <EmptyState title="No cases yet" description="Cases you open appear here with their state and the last update." />
            ) : (
              <TableScroll label="Your support cases">
                <table data-testid="partner-cases">
                  <thead>
                    <tr>
                      <th scope="col">Case</th>
                      <th scope="col">Subject</th>
                      <th scope="col">State</th>
                      <th scope="col">Last update</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map((t) => (
                      <tr key={t.ticket_id}>
                        <td>
                          <a className="cell-strong" href={`/support/${t.ticket_id}`}>
                            {t.public_ref}
                          </a>
                        </td>
                        <td>
                          {TICKET_CATEGORY_LABEL[t.category]}
                          {t.booking_ref ? ` · ${t.booking_ref}` : ""}
                        </td>
                        <td>
                          <StatusPill tone={STATE[t.status].tone}>{STATE[t.status].label}</StatusPill>
                        </td>
                        <td>{formatVenueDateTime(t.updated_at)} IST</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Card>
        </div>
        <div className="ops-side">
          <SupportForm bookings={[]} />
          <p className="fine-print">
            Quote the booking reference in your message. Support checks the booking&apos;s real status and never overrides an unpaid or cancelled pass.
            No UPI PIN, OTP, password or bank details belong in a case.
          </p>
        </div>
      </div>
    </main>
  );
}
