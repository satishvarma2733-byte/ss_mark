import { Check, Clock3, Info } from "lucide-react";
import type { PartnerStatement } from "@simply-sit/contracts";
import { asUser, getDb, partnerStatement } from "@simply-sit/db";
import { formatInrPaise, venueLocalDate } from "../../../lib/format";
import { NotManager, PartnerNav, partnerContext } from "../../../lib/partner-page";
import { PortalBlocked } from "../../../lib/portal-page";
import { longDate } from "../../../components/booking-parts";

export const dynamic = "force-dynamic";

const PAYOUT_TEXT: Record<string, string> = {
  DRAFT: "Being prepared · Not transferred", APPROVED: "Scheduled · Not transferred", PROCESSING: "Transfer in progress", PAID: "Paid", FAILED: "Payout failed",
  CANCELLED: "Cancelled"
};

// Figma "C · Partner desktop · Owner finance and payout setup". Owner-only payout destination and scheduled payouts.
// The destination is set up with the payment provider (M4.4, provider-hosted); Simply Sit never collects bank details.
// Provider onboarding is not connected in this local build, so the destination is shown as not connected.
export default async function PartnerPayoutsPage({ searchParams }: { searchParams: Promise<{ venue?: string }> }) {
  const ctx = await partnerContext("/partner/payouts", (await searchParams).venue, { manager: true });
  if (ctx.state === "blocked") return <PortalBlocked gate={ctx.gate} />;
  if (ctx.state === "not_manager") return <NotManager current={ctx.current} />;
  const owner = ctx.current.role === "OWNER";
  const to = venueLocalDate();
  const from = venueLocalDate(330, Date.now() - 91 * 86_400_000);
  const statement = (await asUser(getDb(), ctx.gate.identity.claims, (tx) => partnerStatement(tx, ctx.current.venue_id, from, to))) as PartnerStatement;
  const payouts = [...statement.payouts].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const scheduled = payouts.find((p) => p.status !== "PAID" && p.status !== "CANCELLED") ?? null;
  const venueQuery = `venue=${ctx.current.venue_id}`;

  return (
    <main>
      <h1>Your settlement destination, secured.</h1>
      <PartnerNav current={ctx.current} memberships={ctx.memberships} active="/partner/reports" />
      <p className="lede">Earnings / Payout setup · {owner ? "Venue owner" : "Manager · read-only"}</p>
      <div className="notice info partner-notice">
        <Info size={20} aria-hidden="true" />
        <div>
          <strong>{owner ? "Owner-only context" : "Read-only for managers"}</strong>
          <p>
            {owner
              ? "Only the venue owner can set or change where payouts go. Managers see this page read-only and cannot change the destination."
              : "Only the venue owner can set or change where payouts go. You can see payout status here."}
          </p>
        </div>
      </div>
      <div className="partner-layout">
        <div className="book-main">
          <section className="card book-card" aria-labelledby="beneficiary-heading">
            <h2 id="beneficiary-heading">Payout destination</h2>
            <span className="status-pill warm">Provider setup · Not connected</span>
            <dl className="detail-rows">
              <div>
                <dt>Destination account</dt>
                <dd>Not set</dd>
              </div>
              <div>
                <dt>Provider verification (KYC)</dt>
                <dd>Not started</dd>
              </div>
              <div>
                <dt>Settlement currency</dt>
                <dd>INR</dd>
              </div>
            </dl>
            <p className="field-hint">
              Bank details and identity checks are handled by the payment provider, never stored by Simply Sit. Provider onboarding is not connected in this
              preview, so no destination can be set yet.
            </p>
            <button className="button" type="button" disabled>
              Open secure destination setup · Not available yet
            </button>
          </section>

          <section className="card book-card" aria-labelledby="change-heading">
            <h2 id="change-heading">Changing the destination</h2>
            <p className="book-when">
              A change needs a reason, a fresh provider verification and the owner’s confirmation. It never redirects a payout that is already scheduled;
              pending payouts are reviewed separately.
            </p>
            <p className="book-note">Every finance action records who did it and when.</p>
          </section>
        </div>

        <div className="book-side">
          <section className="card book-card" aria-labelledby="scheduled-heading">
            <h2 id="scheduled-heading">Scheduled payout</h2>
            {scheduled ? (
              <>
                <dl className="detail-rows">
                  <div className="total-row">
                    <dt>{scheduled.public_ref}</dt>
                    <dd>{formatInrPaise(scheduled.venue_amount_paise)}</dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>{longDate(scheduled.created_at)}</dd>
                  </div>
                  <div>
                    <dt>Bank reference</dt>
                    <dd>{scheduled.evidence_ref ?? "Not issued yet"}</dd>
                  </div>
                </dl>
                <span className="status-pill warm">{PAYOUT_TEXT[scheduled.status] ?? scheduled.status}</span>
              </>
            ) : (
              <p className="book-when">No payout is scheduled right now.</p>
            )}
            <dl className="detail-rows">
              <div>
                <dt>Earned, not yet paid (last 92 days)</dt>
                <dd>{formatInrPaise(Math.max(0, statement.totals.unresolved_paise))}</dd>
              </div>
            </dl>
          </section>

          <section className="card book-card" aria-labelledby="audit-heading">
            <h2 id="audit-heading">Payout history</h2>
            {payouts.length === 0 ? (
              <p className="book-note">No payouts in the last 92 days.</p>
            ) : (
              <ol className="stay-timeline">
                {payouts.slice(0, 5).map((p) => (
                  <li key={p.public_ref}>
                    <span className={`marker ${p.status === "PAID" ? "done" : "wait"}`} aria-hidden="true">
                      {p.status === "PAID" ? <Check size={13} /> : <Clock3 size={13} />}
                    </span>
                    <div>
                      <strong>
                        {longDate(p.paid_at ?? p.created_at)} · {p.public_ref}
                      </strong>
                      <p>
                        {formatInrPaise(p.venue_amount_paise)} · {PAYOUT_TEXT[p.status] ?? p.status}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <a className="button secondary" href={`/partner/reports?${venueQuery}`}>
            Back to earnings
          </a>
        </div>
      </div>
      <div className="workspace-footer">
        <p>SIMPLY SIT · Partner portal</p>
        <p>Asia/Kolkata</p>
      </div>
    </main>
  );
}
