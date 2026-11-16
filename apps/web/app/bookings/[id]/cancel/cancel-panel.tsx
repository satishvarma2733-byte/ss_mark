"use client";

// The amount shown is the server's preview. Confirming sends that amount back; if the database clock now gives a
// different refund (the cutoff passed), nothing is cancelled and the new amount is shown for a fresh confirmation.
// One Idempotency-Key per confirmation: a retried click after a lost response cannot cancel or refund twice.
import { useState } from "react";
import { Info } from "lucide-react";
import {
  CUSTOMER_CANCEL_REASONS, CUSTOMER_CANCEL_REASON_LABEL, type CancelPreview, type CancelResult, type CustomerCancelReason
} from "@simply-sit/contracts";
import { apiCall, newIdempotencyKey } from "../../../../lib/client-api";
import { formatInrPaise, formatVenueDateTime } from "../../../../lib/format";

type Terms = Pick<CancelPreview, "window" | "refund_paise" | "retained_paise" | "captured_paise" | "terms_change_at">;

export function CancelPanel({ bookingId, initial }: { bookingId: string; initial: CancelPreview }) {
  const [terms, setTerms] = useState<Terms>(initial);
  const [version, setVersion] = useState(initial.booking_version);
  const [reason, setReason] = useState<CustomerCancelReason | "">("");
  const [key, setKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "warning" | "error"; text: string } | null>(null);
  const [blocked, setBlocked] = useState(false);

  function chooseReason(value: string) {
    setReason(value as CustomerCancelReason | "");
    setKey(newIdempotencyKey()); // a different request body is a different action
  }

  async function confirm() {
    setBusy(true);
    setMessage(null);
    const result = await apiCall<CancelResult>("POST", `/api/v1/bookings/${bookingId}/cancel`, {
      idempotencyKey: key,
      body: { expected_version: version, expected_refund_paise: terms.refund_paise, ...(reason ? { reason_code: reason } : {}) }
    });
    if (result.ok) {
      window.location.assign(`/bookings/${bookingId}`);
      return;
    }
    setBusy(false);
    if (result.code === "CANCELLATION_CHANGED" && result.details) {
      const next = result.details as unknown as Terms & { booking_version: number };
      setTerms(next);
      setVersion(next.booking_version);
      setKey(newIdempotencyKey());
      setMessage({ tone: "warning", text: "The refund has changed because the cancellation deadline passed. Check the new amount and confirm again." });
    } else if (result.code === "STALE_VERSION" || result.code === "INVALID_TRANSITION") {
      setBlocked(true);
      setMessage({ tone: "error", text: "This booking can no longer be cancelled here (it may have started, been checked in or already been cancelled)." });
    } else {
      // Network or server trouble: the same key is reused on retry, so the cancellation happens at most once.
      setMessage({ tone: "error", text: result.message });
    }
  }

  return (
    <>
      <section className="card book-card" aria-labelledby="refund-heading" data-testid="cancel-panel">
        <h2 id="refund-heading">If you cancel now</h2>
        <dl className="detail-rows">
          <div>
            <dt>Original payment</dt>
            <dd>{formatInrPaise(terms.captured_paise)}</dd>
          </div>
          {terms.retained_paise > 0 ? (
            <div>
              <dt>Not refunded</dt>
              <dd data-testid="cancel-retained">{formatInrPaise(terms.retained_paise)}</dd>
            </div>
          ) : null}
          <div className="total-row">
            <dt>Refund</dt>
            <dd data-testid="cancel-refund">{formatInrPaise(terms.refund_paise)}</dd>
          </div>
        </dl>
        {terms.window === "EARLY" && terms.terms_change_at ? (
          <p className="field-hint">This refund applies if you cancel before {formatVenueDateTime(terms.terms_change_at)} IST.</p>
        ) : null}
        {terms.window === "LATE" && terms.refund_paise === 0 ? (
          <span className="status-pill warm" data-testid="cancel-no-refund">
            The deadline has passed: cancelling now gives no refund. The table will be released for others.
          </span>
        ) : null}
        <p className="field-hint">
          Refunds go back to the original payment method. You will see the refund as in progress until the payment provider confirms it.
        </p>

        <div className="field">
          <label className="field-label" htmlFor="cancel-reason">
            Reason (optional)
          </label>
          <select id="cancel-reason" className="input" value={reason} onChange={(e) => chooseReason(e.target.value)} disabled={busy || blocked}>
            <option value="">Prefer not to say</option>
            {CUSTOMER_CANCEL_REASONS.map((code) => (
              <option key={code} value={code}>
                {CUSTOMER_CANCEL_REASON_LABEL[code]}
              </option>
            ))}
          </select>
        </div>

        {message ? (
          <p className={`book-when ${message.tone === "warning" ? "status-warning" : "status-error"}`} role="alert" data-testid="cancel-message">
            {message.text}
          </p>
        ) : null}
        {blocked ? (
          <a className="button" href={`/bookings/${bookingId}`}>
            See booking
          </a>
        ) : (
          <button className="button danger" type="button" onClick={() => void confirm()} disabled={busy} aria-busy={busy} data-testid="confirm-cancel">
            {busy ? "Cancelling…" : terms.refund_paise > 0 ? `Cancel and refund ${formatInrPaise(terms.refund_paise)}` : "Cancel without refund"}
          </button>
        )}
        <a className="button secondary" href={`/bookings/${bookingId}`}>
          Keep booking
        </a>
      </section>
      <div className="notice info">
        <Info size={20} aria-hidden="true" />
        <div>
          <strong>After you cancel</strong>
          <p>Your pass stops working and the table is released. You can follow the refund on the booking page until the provider confirms it.</p>
        </div>
      </div>
    </>
  );
}
