import type { PartnerStatement } from "@simply-sit/contracts";
import { asUser, DomainError, getDb, partnerStatement } from "@simply-sit/db";
import { formatInrPaise, formatSignedInrPaise, formatVenueDateTime, venueLocalDate } from "../../../lib/format";
import { NotManager, PartnerNav, partnerContext } from "../../../lib/partner-page";
import { PortalBlocked } from "../../../lib/portal-page";
import { TableScroll } from "../../../lib/table-scroll";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAYOUT_TEXT: Record<string, string> = {
  UNPAID: "not yet in a payout", DRAFT: "payout being prepared", APPROVED: "payout approved", PROCESSING: "transfer in progress",
  PAID: "paid", FAILED: "payout failed", CANCELLED: "not yet in a payout"
};
const payoutText = (status: string) => PAYOUT_TEXT[status] ?? status.toLowerCase();

// P07 - the venue's statement for managers/owners with TOTP: what each finished booking earned after the platform fee,
// refunds charged to the venue, and this venue's share of each payout. Anything not yet paid is shown as unresolved.
export default async function PartnerReportsPage({ searchParams }: { searchParams: Promise<{ venue?: string; from?: string; to?: string }> }) {
  const query = await searchParams;
  const ctx = await partnerContext("/partner/reports", query.venue, { manager: true });
  if (ctx.state === "blocked") return <PortalBlocked gate={ctx.gate} />;
  if (ctx.state === "not_manager") return <NotManager current={ctx.current} />;
  const today = venueLocalDate();
  const to = query.to && DATE.test(query.to) ? query.to : today;
  const from = query.from && DATE.test(query.from) ? query.from : `${to.slice(0, 8)}01`;
  const venueId = ctx.current.venue_id;
  let statement: PartnerStatement | null = null;
  let problem: string | null = null;
  try {
    statement = await asUser(getDb(), ctx.gate.identity.claims, (tx) => partnerStatement(tx, venueId, from, to));
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== "VALIDATION_FAILED") throw error;
    problem = "Choose a period of at most 92 days, with the start before the end.";
  }
  const csv = `/api/v1/partner/venues/${venueId}/statement?from=${from}&to=${to}&format=csv`;

  return (
    <main>
      <h1>Reports</h1>
      <PartnerNav current={ctx.current} memberships={ctx.memberships} active="/partner/reports" />
      <p className="page-lede">
        <a className="text-link" href={`/partner/payouts?venue=${venueId}`}>
          Payout destination and scheduled payouts →
        </a>
      </p>
      <form className="inline-form" method="get" action="/partner/reports" aria-label="Statement period">
        <input type="hidden" name="venue" value={venueId} />
        <label>
          From
          <input className="input" type="date" name="from" defaultValue={from} required />
        </label>
        <label>
          To
          <input className="input" type="date" name="to" defaultValue={to} max={today} required />
        </label>
        <button className="button secondary" type="submit">Show</button>
        {statement ? <a className="button" href={csv} data-testid="statement-csv">Download CSV</a> : null}
      </form>
      {problem ? <p className="notice status-error" role="alert">{problem}</p> : null}
      {statement ? (
        <>
          <p className="notice status-warning" role="note">
            Test data from the MOCK payment provider. Amounts not yet in a paid payout are unresolved.
          </p>
          <section className="card" aria-labelledby="totals-heading" data-testid="statement-totals">
            <h2 id="totals-heading">Summary</h2>
            <ul>
              <li>Bookings earned: {formatInrPaise(statement.totals.gross_paise)}</li>
              <li>Platform fees: {formatInrPaise(statement.totals.platform_fee_paise)}</li>
              <li>Your earnings: {formatInrPaise(statement.totals.earned_paise)}</li>
              <li>Refunds charged to the venue: {statement.totals.adjustments_paise > 0 ? `-${formatInrPaise(statement.totals.adjustments_paise)}` : formatInrPaise(0)}</li>
              <li>Paid out: <strong data-testid="statement-paid">{formatSignedInrPaise(statement.totals.paid_paise)}</strong></li>
              <li className={statement.totals.unresolved_paise !== 0 ? "status-warning" : undefined}>
                Unresolved (not yet paid): <strong data-testid="statement-unresolved">{formatSignedInrPaise(statement.totals.unresolved_paise)}</strong>
              </li>
            </ul>
            {statement.not_yet_earned.count > 0 ? (
              <p className="food-note">
                {statement.not_yet_earned.count} paid bookings in this period have not finished yet, so they are not earnings yet.
              </p>
            ) : null}
          </section>

          <section className="card" style={{ marginTop: 16 }} aria-labelledby="earn-heading">
            <h2 id="earn-heading">Bookings</h2>
            {statement.earnings.length === 0 ? <p className="food-note">No finished bookings in this period.</p> : (
              <TableScroll label="Statement bookings">
                <table className="data-table" data-testid="statement-earnings">
                  <thead>
                    <tr><th scope="col">Booking</th><th scope="col">Start (IST)</th><th scope="col">Outcome</th><th scope="col">Earned</th><th scope="col">Fee</th><th scope="col">Yours</th><th scope="col">Payout</th></tr>
                  </thead>
                  <tbody>
                    {statement.earnings.map((e) => (
                      <tr key={e.booking_id}>
                        <td>{e.public_ref}</td>
                        <td>{formatVenueDateTime(e.start_at)}</td>
                        <td>{e.booking_status.toLowerCase().replace("_", " ")}</td>
                        <td>{formatInrPaise(e.gross_paise)}</td>
                        <td>{formatInrPaise(e.platform_fee_paise)}</td>
                        <td>{formatInrPaise(e.partner_paise)}</td>
                        <td>{e.payout_ref ? `${e.payout_ref}: ` : ""}{payoutText(e.payout_status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </section>

          {statement.adjustments.length > 0 ? (
            <section className="card" style={{ marginTop: 16 }} aria-labelledby="adj-heading">
              <h2 id="adj-heading">Refunds charged to the venue</h2>
              <p className="food-note">Approved by Simply Sit support after the booking finished. Deducted from the next payout.</p>
              <ul data-testid="statement-adjustments">
                {statement.adjustments.map((a) => (
                  <li key={a.refund_id}>
                    {a.public_ref} · -{formatInrPaise(a.amount_paise)} · {formatVenueDateTime(a.created_at)} IST ·{" "}
                    {a.payout_ref ? `${a.payout_ref}: ` : ""}{payoutText(a.payout_status)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="card" style={{ marginTop: 16 }} aria-labelledby="po-heading">
            <h2 id="po-heading">Payouts</h2>
            {statement.payouts.length === 0 ? <p className="food-note">No payouts in this period.</p> : (
              <ul data-testid="statement-payouts">
                {statement.payouts.map((p) => (
                  <li key={p.public_ref}>
                    {p.public_ref} · {payoutText(p.status)} · this venue {formatSignedInrPaise(p.venue_amount_paise)}
                    {p.paid_at ? ` · paid ${formatVenueDateTime(p.paid_at)} IST` : ""}
                    {p.evidence_ref ? ` · reference ${p.evidence_ref}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
