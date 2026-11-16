"use client";

import { useState } from "react";
import { CircleAlert, RotateCcw } from "lucide-react";
import { formatInrPaise } from "../../../../lib/format";
import { useAction } from "../../../../lib/use-action";
import { Button } from "../../../../components/ui";

export type RefundOptions = {
  max_refund_paise: number;
  needs_charge_to: boolean;
  booking_liability_paise: number;
  earned: { gross_paise: number; partner_paise: number; platform_fee_paise: number } | null;
  retryable: { refund_id: string; amount_paise: number; reason_code: string; last_error_code: string | null }[];
};

// A refund the provider refused is still owed. Retrying sends the same amount again as a new provider operation; it
// creates no new charge to the partner or Simply Sit.
export function FailedRefunds({ items }: { items: RefundOptions["retryable"] }) {
  const action = useAction();
  const [reason, setReason] = useState("");
  if (items.length === 0) return null;
  return (
    <div className="refund-block" data-testid="failed-refunds">
      <div className="notice warm" role="note">
        <CircleAlert size={18} aria-hidden="true" />
        <div>
          <strong>{items.length === 1 ? "A refund failed at the payment provider" : `${items.length} refunds failed at the payment provider`}</strong>
          <p>The customer is still owed the money.</p>
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="retry-reason">Reason for the retry · kept in the audit log</label>
        <input id="retry-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-testid="retry-reason" />
      </div>
      <ul className="retry-list">
        {items.map((r) => (
          <li key={r.refund_id}>
            <span>
              <strong>{formatInrPaise(r.amount_paise)}</strong> · {r.reason_code.toLowerCase().replace(/_/g, " ")}
              {r.last_error_code ? ` · ${r.last_error_code}` : ""}
            </span>
            <Button variant="secondary" type="button" disabled={action.busy !== null || reason.trim().length < 10}
              data-testid={`retry-${r.refund_id}`}
              onClick={() => void action.run(`retry-${r.refund_id}`, "POST", `/api/v1/admin/refunds/${r.refund_id}/retry`, { reason },
                { idempotent: true, success: "Retry requested." })}>
              <RotateCcw size={16} aria-hidden="true" />
              Retry refund
            </Button>
          </li>
        ))}
      </ul>
      {action.message ? <p className={`status-${action.message.tone}`} role="status">{action.message.text}</p> : null}
    </div>
  );
}

// A03/A05 finance refund. The server decides what is refundable and who bears it; this form only collects the
// amount, the reason and (for a finished booking) whether the partner or Simply Sit pays.
export function AdminRefundForm({ bookingId, options }: { bookingId: string; options: RefundOptions }) {
  const action = useAction();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [chargeTo, setChargeTo] = useState<"PARTNER" | "PLATFORM">("PLATFORM");
  const paise = Math.round(Number(amount) * 100);
  const valid = Number.isFinite(paise) && paise > 0 && paise <= options.max_refund_paise && reason.trim().length >= 10;

  if (options.max_refund_paise <= 0) return <p className="notice">Nothing left to refund on this booking.</p>;
  return (
    <form className="refund-block" data-testid="admin-refund-form" onSubmit={(e) => {
      e.preventDefault();
      void action.run("refund", "POST", "/api/v1/admin/refunds", {
        booking_id: bookingId, amount_paise: paise, reason, ...(options.needs_charge_to ? { charge_to: chargeTo } : {})
      }, { idempotent: true, success: "Refund requested. It shows as refunded once the payment provider confirms it." });
    }}>
      <p className="small">
        Up to <strong>{formatInrPaise(options.max_refund_paise)}</strong>.{" "}
        {options.needs_charge_to
          ? "The booking has finished, so choose who bears this refund."
          : "The booking has not finished: the refund comes out of what it will earn."}
      </p>
      <div className="refund-fields">
        <div className="field">
          <label className="field-label" htmlFor="refund-amount">Amount (₹)</label>
          <input id="refund-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="refund-amount" required />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="refund-reason">Reason / case note · required</label>
          <textarea id="refund-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} maxLength={500} rows={2}
            data-testid="refund-reason" required />
        </div>
      </div>
      {options.needs_charge_to ? (
        <fieldset className="decision-options">
          <legend className="field-label">Charged to</legend>
          <label className="chip">
            <input type="radio" name="charge" checked={chargeTo === "PLATFORM"} onChange={() => setChargeTo("PLATFORM")} /> Simply Sit
          </label>
          <label className="chip">
            <input type="radio" name="charge" checked={chargeTo === "PARTNER"} onChange={() => setChargeTo("PARTNER")} data-testid="charge-partner" /> The partner
            (next payout)
          </label>
        </fieldset>
      ) : null}
      <div className="row-buttons">
        <Button type="submit" disabled={!valid || action.busy !== null} data-testid="refund-submit">
          Request refund
        </Button>
      </div>
      {action.message ? <p className={`status-${action.message.tone}`} role="status">{action.message.text}</p> : null}
    </form>
  );
}
