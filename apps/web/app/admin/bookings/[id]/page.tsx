import { notFound } from "next/navigation";
import { Check, CircleAlert, Clock3, Info, LifeBuoy } from "lucide-react";
import { adminBookingDetail, adminRefundOptions, asUser, DomainError, getDb } from "@simply-sit/db";
import { formatInrPaise, formatVenueDateTime, formatVenueTime } from "../../../../lib/format";
import { gatePortal, PortalBlocked } from "../../../../lib/portal-page";
import { AdminRefundForm, FailedRefunds, type RefundOptions } from "./admin-refund-form";
import { AdminNav } from "../../../../lib/admin-nav";
import { BookingOpsHeading, BookingRecordList, BookingSearchForm, bookingPill, bookingQuery, searchBookings } from "../booking-records";
import { Card, StatusPill } from "../../../../components/ui";

export const dynamic = "force-dynamic";

type Detail = {
  booking: { booking_id: string; public_ref: string; status: string; start_at: string; end_at: string; party_size: number; total_paise: number;
             cancel_reason: string | null; venue_name: string; table_label: string; policy_version: number };
  events: { event_type: string; from_status: string | null; to_status: string | null; reason_code: string | null; at: string }[];
  payments: { payment_order_id: string; order_state: string; extension_id: string | null; expected_amount_paise: number;
              attempts: { attempt_id: string; state: string; amount_paise: number; allocation_state: string; captured_at: string | null }[] }[];
  refunds: { refund_id: string; amount_paise: number; reason_code: string; status: string; created_at: string }[];
  extensions: { status: string; additional_minutes: number; amount_paise: number; created_at: string }[];
  tickets: { ticket_id: string; public_ref: string; status: string; category: string }[];
};

type Step = { at: string | null; title: string; detail: string; state: "done" | "waiting" | "failed" };

const words = (code: string) => code.toLowerCase().replace(/_/g, " ");
const IN_FLIGHT = new Set(["REQUESTED", "PROCESSING", "UNKNOWN"]);

function attemptPill(state: string) {
  if (state === "CAPTURED") return { text: "Payment captured", tone: "" };
  if (state === "FAILED") return { text: "Payment failed", tone: " danger" };
  return { text: `Payment ${words(state)}`, tone: " warm" };
}

function refundPill(status: string, paise: number) {
  const tone = status === "PROCESSED" ? "" : status === "FAILED" ? " danger" : " warm";
  return { text: `Refund ${words(status)} · ${formatInrPaise(paise)}`, tone };
}

// Payments, refunds and extensions in time order. Attempts without a capture time (still pending or failed) come last.
function moneySteps(d: Detail): Step[] {
  const steps: Step[] = [];
  for (const o of d.payments) {
    for (const a of o.attempts) {
      steps.push({
        at: a.captured_at,
        title: `${formatInrPaise(a.amount_paise)} ${words(a.state)}`,
        detail: `${o.extension_id ? "Extension" : "Booking"} payment · ${words(a.allocation_state)} · order ${words(o.order_state)}`,
        state: a.state === "CAPTURED" ? "done" : a.state === "FAILED" ? "failed" : "waiting"
      });
    }
  }
  for (const r of d.refunds) {
    steps.push({
      at: r.created_at,
      title: `${formatInrPaise(r.amount_paise)} refund · ${words(r.status)}`,
      detail: `${words(r.reason_code)} · counts once the payment provider confirms it`,
      state: r.status === "PROCESSED" ? "done" : r.status === "FAILED" ? "failed" : "waiting"
    });
  }
  for (const x of d.extensions) {
    steps.push({ at: x.created_at, title: `+${x.additional_minutes} min extension · ${words(x.status)}`, detail: formatInrPaise(x.amount_paise), state: "done" });
  }
  return steps.sort((a, b) => (a.at && b.at ? a.at.localeCompare(b.at) : a.at ? -1 : b.at ? 1 : 0));
}

function StepIcon({ state }: { state: Step["state"] }) {
  if (state === "done") return <Check size={14} aria-hidden="true" />;
  if (state === "failed") return <CircleAlert size={14} aria-hidden="true" />;
  return <Clock3 size={14} aria-hidden="true" />;
}

// A03 - one booking's timeline, payments (each actual attempt), refunds, extensions and visible tickets. No arrival
// codes or payment secrets. Viewing is audited. Service recovery uses the booking's service-cancel action; money
// remedies are finance actions: finance/superadmin see the refund form (A05).
export default async function AdminBookingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const gate = await gatePortal(`/admin/bookings/${id}`, (me) => me.platform_roles.length > 0);
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const d = (await asUser(getDb(), gate.identity.claims, (tx) => adminBookingDetail(tx, id)).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  })) as Detail;
  const b = d.booking;
  const finance = gate.me.platform_roles.some((r) => r === "FINANCE" || r === "SUPERADMIN");
  const refundOptions = finance
    ? ((await asUser(getDb(), gate.identity.claims, (tx) => adminRefundOptions(tx, id))) as RefundOptions)
    : null;
  // The records column repeats the search the admin came from (links carry it), so the list stays in view.
  const q = bookingQuery(await searchParams);
  const result = await searchBookings(gate.identity.claims, q);

  const pill = bookingPill(b.status);
  const attempts = d.payments.filter((o) => !o.extension_id).flatMap((o) => o.attempts);
  const captured = d.payments.flatMap((o) => o.attempts).filter((a) => a.state === "CAPTURED").reduce((s, a) => s + a.amount_paise, 0);
  const refunded = d.refunds.filter((r) => r.status === "PROCESSED").reduce((s, r) => s + r.amount_paise, 0);
  const refunding = d.refunds.filter((r) => IN_FLIGHT.has(r.status)).reduce((s, r) => s + r.amount_paise, 0);
  const steps = moneySteps(d);
  const earned = refundOptions?.earned ?? null;

  return (
    <main>
      <AdminNav roles={gate.me.platform_roles} active="/admin/bookings" />
      <BookingOpsHeading />
      <BookingSearchForm q={q} />
      <div className="review-layout">
        <BookingRecordList
          result={result}
          q={q}
          selected={{ booking_id: b.booking_id, public_ref: b.public_ref, status: b.status, venue_name: b.venue_name, start_at: b.start_at, end_at: b.end_at, total_paise: b.total_paise }}
        />

        <div className="review-detail">
          <Card aria-labelledby="booking-heading">
            <div className="section-heading">
              <h2 id="booking-heading" className="record-title">
                {b.public_ref}
              </h2>
              <span className={`status-pill${pill.tone}`}>{pill.text}</span>
            </div>
            <p data-testid="admin-booking-status">
              {b.venue_name} · {b.table_label} · {b.party_size} {b.party_size === 1 ? "guest" : "guests"}
            </p>
            <p className="muted small">
              {formatVenueDateTime(b.start_at)}–{formatVenueTime(b.end_at)} IST · Policy version {b.policy_version}
              {b.cancel_reason ? ` · Cancel reason: ${words(b.cancel_reason)}` : ""}
            </p>
            <hr />
            <ul className="chips" aria-label="Money states">
              {attempts.length === 0 ? (
                <li>
                  <StatusPill tone="neutral">No payment attempt</StatusPill>
                </li>
              ) : (
                attempts.map((a) => {
                  const p = attemptPill(a.state);
                  return (
                    <li key={a.attempt_id}>
                      <span className={`status-pill${p.tone}`}>{p.text}</span>
                    </li>
                  );
                })
              )}
              {d.refunds.map((r) => {
                const p = refundPill(r.status, r.amount_paise);
                return (
                  <li key={r.refund_id}>
                    <span className={`status-pill${p.tone}`}>{p.text}</span>
                  </li>
                );
              })}
            </ul>
            <p className="fine-print">Cancelling releases the table; a refund is not marked paid until the payment provider confirms it.</p>
          </Card>

          <div className="pair-columns">
            <Card aria-labelledby="money-heading">
              <h2 id="money-heading">Payment &amp; refund timeline</h2>
              {steps.length === 0 ? (
                <p className="muted">No payments yet.</p>
              ) : (
                <ol className="timeline">
                  {steps.map((s, i) => (
                    <li key={i} className={s.state === "done" ? "done" : s.state === "failed" ? "failed" : undefined}>
                      <span className="marker">
                        <StepIcon state={s.state} />
                      </span>
                      <div>
                        <strong>
                          {s.at ? `${formatVenueDateTime(s.at)} · ` : ""}
                          {s.title}
                        </strong>
                        <span>{s.detail}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <Card aria-labelledby="rupee-heading">
              <h2 id="rupee-heading">Every rupee accounted for</h2>
              <dl className="detail-rows">
                <div>
                  <dt>Booking total</dt>
                  <dd>{formatInrPaise(b.total_paise)}</dd>
                </div>
                <div>
                  <dt>Captured</dt>
                  <dd>{formatInrPaise(captured)}</dd>
                </div>
                {refunded > 0 ? (
                  <div>
                    <dt>Refunded</dt>
                    <dd>− {formatInrPaise(refunded)}</dd>
                  </div>
                ) : null}
                {refunding > 0 ? (
                  <div>
                    <dt>Refunds in progress</dt>
                    <dd>− {formatInrPaise(refunding)}</dd>
                  </div>
                ) : null}
                <div className="total-row">
                  <dt>Retained balance</dt>
                  <dd>{formatInrPaise(captured - refunded - refunding)}</dd>
                </div>
              </dl>
              {earned ? (
                <>
                  <hr />
                  <dl className="detail-rows">
                    <div>
                      <dt>Earned (gross)</dt>
                      <dd>{formatInrPaise(earned.gross_paise)}</dd>
                    </div>
                    <div>
                      <dt>Venue share</dt>
                      <dd>{formatInrPaise(earned.partner_paise)}</dd>
                    </div>
                    <div>
                      <dt>Simply Sit fee</dt>
                      <dd>{formatInrPaise(earned.platform_fee_paise)}</dd>
                    </div>
                  </dl>
                </>
              ) : null}
              <p className="fine-print">
                Captured counts verified payment attempts only. {finance ? "" : "Earnings and fees are shown to finance roles."}
              </p>
            </Card>
          </div>

          <Card aria-labelledby="rf-heading">
            <div className="section-heading stacked">
              <h2 id="rf-heading">Support &amp; refund actions</h2>
              <p className="small">
                {finance ? "Refunds are finance actions with a recorded reason." : "Refunds are finance actions. Raise a support ticket for a finance review."}
              </p>
            </div>
            {refundOptions ? (
              <>
                <FailedRefunds items={refundOptions.retryable} />
                <AdminRefundForm bookingId={b.booking_id} options={refundOptions} />
              </>
            ) : null}
            {d.tickets.length > 0 ? (
              <ul className="plain-list">
                {d.tickets.map((t) => (
                  <li key={t.ticket_id}>
                    <a href={`/admin/support/${t.ticket_id}`}>{t.public_ref}</a> · {words(t.category)} · {words(t.status)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">
                <LifeBuoy size={14} aria-hidden="true" /> No support tickets on this booking.
              </p>
            )}
            <div className="notice info">
              <Info size={18} aria-hidden="true" />
              <div>
                <strong>Refunds cannot exceed what was paid</strong>
                <p>The server caps each refund at what is still refundable and ignores a repeated submission of the same request.</p>
              </div>
            </div>
          </Card>

          <Card aria-labelledby="ev-heading">
            <h2 id="ev-heading">Booking history</h2>
            <ol className="timeline" data-testid="booking-timeline">
              {d.events.map((e, i) => (
                <li key={i} className="done">
                  <span className="marker">
                    <Check size={14} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>
                      {formatVenueDateTime(e.at)} · {words(e.event_type)}
                    </strong>
                    <span>
                      {e.from_status && e.to_status ? `${words(e.from_status)} → ${words(e.to_status)}` : e.to_status ? words(e.to_status) : "No status change"}
                      {e.reason_code ? ` · ${words(e.reason_code)}` : ""}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </main>
  );
}
