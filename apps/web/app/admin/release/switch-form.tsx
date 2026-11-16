"use client";

import { useState } from "react";
import { useAction } from "../../../lib/use-action";

// Opens or closes one release switch. The reason is required and lands in the audit log with the change.
export function SwitchForm({ switchKey, isOpen, version, label }: { switchKey: string; isOpen: boolean; version: number; label: string }) {
  const action = useAction();
  const [reason, setReason] = useState("");
  const next = !isOpen;
  return (
    <form className="inline-form" data-testid={`switch-form-${switchKey}`} onSubmit={(e) => {
      e.preventDefault();
      void action.run("set", "POST", "/api/v1/admin/release-switches", { key: switchKey, is_open: next, reason, expected_version: version },
        { idempotent: true, success: next ? `${label} opened.` : `${label} paused.` }).then((r) => {
        if (r.ok) setReason("");
      });
    }}>
      <label>
        Reason (recorded in the audit log)
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} maxLength={500} required
          data-testid={`switch-reason-${switchKey}`} />
      </label>
      <button className={next ? "button" : "button danger"} type="submit" disabled={action.busy !== null} data-testid={`switch-toggle-${switchKey}`}>
        {action.busy ? "Saving..." : next ? `Open ${label.toLowerCase()}` : `Pause ${label.toLowerCase()}`}
      </button>
      {action.message ? <span className={`status-${action.message.tone}`} role="status">{action.message.text}</span> : null}
    </form>
  );
}
