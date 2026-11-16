"use client";

import { useState } from "react";
import { useAction } from "../../../lib/use-action";
import { Button } from "../../../components/ui";

// datetime-local values are the admin's local time; the API takes ISO instants with an offset.
const toIso = (local: string) => new Date(local).toISOString();
const localInput = (at: number) => {
  const d = new Date(at - new Date(at).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

function Message({ message }: { message: ReturnType<typeof useAction>["message"] }) {
  return message ? <span className={`status-${message.tone}`} role="status">{message.text}</span> : null;
}

export function ReconcileForm() {
  const action = useAction();
  const [from, setFrom] = useState(() => localInput(Date.now() - 86_400_000));
  // Rounded up to the next minute so a run just started covers everything so far (the server caps it at now).
  const [to, setTo] = useState(() => localInput(Date.now() + 60_000));
  const [result, setResult] = useState<string | null>(null);
  return (
    <form className="inline-form" data-testid="reconcile-form" onSubmit={(e) => {
      e.preventDefault();
      setResult(null);
      void action.run<{ status: string; exception_count: number }>("reconcile", "POST", "/api/v1/admin/reconciliation",
        { from: toIso(from), to: toIso(to) }).then((r) => {
        if (r.ok) setResult(r.data.status === "MATCHED" ? "Matched the provider." : `${r.data.exception_count} ${r.data.exception_count === 1 ? "exception" : "exceptions"} found.`);
      });
    }}>
      <label>
        From
        <input className="input" type="datetime-local" step={1} value={from} onChange={(e) => setFrom(e.target.value)} data-testid="reconcile-from" required />
      </label>
      <label>
        To
        <input className="input" type="datetime-local" step={1} value={to} onChange={(e) => setTo(e.target.value)} data-testid="reconcile-to" required />
      </label>
      <Button type="submit" disabled={action.busy !== null} data-testid="reconcile-run">
        {action.busy ? "Reconciling..." : "Run reconciliation"}
      </Button>
      {result ? <span className="status-success" role="status" data-testid="reconcile-result">{result}</span> : null}
      <Message message={action.message} />
    </form>
  );
}

export function DraftPayoutButton({ partnerId }: { partnerId: string }) {
  const action = useAction();
  return (
    <span className="inline-form">
      <Button variant="secondary" type="button" disabled={action.busy !== null} data-testid={`draft-payout-${partnerId}`}
        onClick={() => void action.run("draft", "POST", "/api/v1/admin/payout-batches", { partner_id: partnerId },
          { idempotent: true, success: "Payout drafted." })}>
        Draft payout
      </Button>
      <Message message={action.message} />
    </span>
  );
}

export function PayoutActions({ batchId, status, version, createdByMe }: { batchId: string; status: string; version: number; createdByMe: boolean }) {
  const action = useAction();
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const mark = (next: string, body: Record<string, unknown>, success: string) =>
    void action.run(next, "POST", `/api/v1/admin/payout-batches/${batchId}/status`, { status: next, expected_version: version, ...body },
                    { idempotent: true, success });
  const busy = action.busy !== null;
  return (
    <div className="inline-form" data-testid={`payout-actions-${batchId}`}>
      {status === "DRAFT" ? (
        createdByMe ? (
          <span className="food-note">Another finance person must approve this draft.</span>
        ) : (
          <Button type="button" disabled={busy} data-testid={`approve-payout-${batchId}`}
            onClick={() => void action.run("approve", "POST", `/api/v1/admin/payout-batches/${batchId}/approve`, { expected_version: version },
              { idempotent: true, success: "Approved." })}>
            Approve
          </Button>
        )
      ) : null}
      {status === "APPROVED" || status === "PROCESSING" ? (
        <>
          <label>
            {status === "APPROVED" ? "Transfer or bank reference" : "Bank reference (UTR) or provider proof"}
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120}
              data-testid={`payout-reference-${batchId}`} />
          </label>
          {status === "APPROVED" ? (
            <Button variant="secondary" type="button" disabled={busy}
              onClick={() => mark("PROCESSING", reference.trim() ? { reference: reference.trim() } : {}, "Marked as processing.")}>
              Transfer started
            </Button>
          ) : null}
          <Button type="button" disabled={busy || reference.trim().length < 6} data-testid={`mark-paid-${batchId}`}
            onClick={() => mark("PAID", { reference: reference.trim() }, "Marked as paid.")}>
            Mark paid
          </Button>
        </>
      ) : null}
      {status === "DRAFT" || status === "APPROVED" || status === "PROCESSING" ? (
        <>
          <label>
            Reason
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </label>
          <Button variant="secondary" type="button" disabled={busy || reason.trim().length < 3}
            onClick={() => mark(status === "DRAFT" ? "CANCELLED" : "FAILED", { reason: reason.trim() },
                                status === "DRAFT" ? "Draft cancelled." : "Marked as failed; the amounts are available again.")}>
            {status === "DRAFT" ? "Cancel draft" : "Mark failed"}
          </Button>
        </>
      ) : null}
      <Message message={action.message} />
    </div>
  );
}

export function FeeConfigForm() {
  const action = useAction();
  const [version, setVersion] = useState("");
  const [percent, setPercent] = useState("");
  const [fixed, setFixed] = useState("0");
  const [from, setFrom] = useState(() => localInput(Date.now() + 7 * 86_400_000));
  const bps = Math.round(Number(percent) * 100);
  const fixedPaise = Math.round(Number(fixed) * 100);
  const valid = /^[A-Z0-9][A-Z0-9._-]{2,59}$/.test(version) && Number.isInteger(bps) && bps >= 0 && bps <= 10_000 && fixedPaise >= 0;
  return (
    <form className="stack" data-testid="fee-config-form" onSubmit={(e) => {
      e.preventDefault();
      void action.run("fee", "POST", "/api/v1/admin/fee-configurations", {
        config_version: version, commission_bps: bps, platform_fixed_paise: fixedPaise, customer_fee_paise: 0, effective_from: toIso(from)
      }, { idempotent: true, success: "Draft saved. Another finance person must approve it." });
    }}>
      <label>
        Version name (capitals, digits, . _ -)
        <input className="input" value={version} onChange={(e) => setVersion(e.target.value.toUpperCase())} maxLength={60} data-testid="fee-version" required />
      </label>
      <label>
        Commission (%)
        <input className="input" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} data-testid="fee-percent" required />
      </label>
      <label>
        Fixed platform fee per booking (Rs)
        <input className="input" inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} data-testid="fee-fixed" />
      </label>
      <label>
        Effective from (must be in the future)
        <input className="input" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="fee-from" required />
      </label>
      <Button type="submit" disabled={!valid || action.busy !== null} data-testid="fee-submit">
        Save draft
      </Button>
      <Message message={action.message} />
    </form>
  );
}

export function ApproveFeeButton({ feeConfigId, version }: { feeConfigId: string; version: number }) {
  const action = useAction();
  return (
    <span className="inline-form">
      <Button variant="secondary" type="button" disabled={action.busy !== null} data-testid={`approve-fee-${feeConfigId}`}
        onClick={() => void action.run("approve", "POST", `/api/v1/admin/fee-configurations/${feeConfigId}/approve`, { expected_version: version },
          { idempotent: true, success: "Approved." })}>
        Approve
      </Button>
      <Message message={action.message} />
    </span>
  );
}
