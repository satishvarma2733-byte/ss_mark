"use client";

// Figma "Record a reasoned decision": publish, or hide with a policy reason. Both keep the original text and are audited.
import { useState } from "react";
import { useAction } from "../../../lib/use-action";
import { Button, Card } from "../../../components/ui";

export function ModerateButtons({ reviewId, version, status }: { reviewId: string; version: number; status: string }) {
  const action = useAction();
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState(false);
  const path = `/api/v1/admin/reviews/${reviewId}/moderate`;
  return (
    <Card className="book-card" aria-labelledby="decision-heading">
      <h2 id="decision-heading">Record a reasoned decision</h2>
      {status !== "HIDDEN" ? (
        <div className="field">
          <label className="field-label" htmlFor="hide-reason">
            Policy reason · required to hide
          </label>
          <textarea id="hide-reason" className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </div>
      ) : null}
      <label className="check-row">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>I checked the review text and that it comes from a completed stay.</span>
      </label>
      {status !== "PUBLISHED" ? (
        <Button type="button" disabled={action.busy !== null} data-testid={`publish-${reviewId}`}
          onClick={() => void action.run("publish", "POST", path, { decision: "PUBLISH", expected_version: version }, { success: "Published." })}>
          Confirm publish
        </Button>
      ) : null}
      {status !== "HIDDEN" ? (
        <Button variant="secondary" type="button" disabled={action.busy !== null || reason.trim().length < 3 || !checked}
          onClick={() => void action.run("hide", "POST", path, { decision: "HIDE", reason, expected_version: version }, { success: "Hidden." })}>
          Hide with policy reason
        </Button>
      ) : null}
      <p className="field-hint">Every decision keeps the original text, actor, reason and time. Hiding keeps the review internally.</p>
      {action.message ? (
        <p className={`book-when status-${action.message.tone}`} role="status">
          {action.message.text}
        </p>
      ) : null}
    </Card>
  );
}
