"use client";

import { useState } from "react";
import { BellRing, Megaphone, ShieldCheck, Users } from "lucide-react";
import type { NotificationPreferences } from "@simply-sit/contracts";
import { apiCall } from "../../../lib/client-api";
import { Button, Card, StatusPill, Switch } from "../../../components/ui";

type Choices = { email_copies: boolean; marketing: boolean };

export function PreferencesForm({ initial }: { initial: Choices }) {
  const [saved, setSaved] = useState<Choices>(initial);
  const [draft, setDraft] = useState<Choices>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const dirty = draft.email_copies !== saved.email_copies || draft.marketing !== saved.marketing;

  async function save() {
    setBusy(true);
    setMessage(null);
    const result = await apiCall<NotificationPreferences>("PUT", "/api/v1/me/notification-preferences", { body: draft });
    setBusy(false);
    if (result.ok) {
      const next = { email_copies: result.data.email_copies, marketing: result.data.marketing };
      setSaved(next);
      setDraft(next);
      setMessage({ tone: "ok", text: "Preferences saved." });
    } else {
      setMessage({ tone: "error", text: `Not saved. ${result.message}` });
    }
  }

  return (
    <form
      className="preference-list"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Card className="preference">
        <span className="preference-icon" aria-hidden="true">
          <ShieldCheck size={20} />
        </span>
        <div className="preference-copy">
          <h2>Essential booking &amp; security</h2>
          <p>Cancellations, refunds, extension decisions and support replies. Always in your inbox and always emailed.</p>
        </div>
        <StatusPill tone="sage">Always on</StatusPill>
      </Card>

      <Card className="preference">
        <span className="preference-icon" aria-hidden="true">
          <BellRing size={20} />
        </span>
        <div className="preference-copy">
          <h2>Email booking copies</h2>
          <p>Optional email copies of confirmations, end-of-time reminders and review updates. They stay in your inbox either way.</p>
        </div>
        <Switch
          label="Email booking copies"
          hideLabel
          checked={draft.email_copies}
          disabled={busy}
          onChange={(value) => setDraft((d) => ({ ...d, email_copies: value }))}
        />
      </Card>

      <Card className="preference">
        <span className="preference-icon" aria-hidden="true">
          <Megaphone size={20} />
        </span>
        <div className="preference-copy">
          <h2>Offers &amp; announcements</h2>
          <p>Optional marketing. Simply Sit does not send any yet; this records your choice. It never affects essential booking messages.</p>
        </div>
        <Switch
          label="Offers and announcements"
          hideLabel
          checked={draft.marketing}
          disabled={busy}
          onChange={(value) => setDraft((d) => ({ ...d, marketing: value }))}
        />
      </Card>

      <Card className="preference">
        <span className="preference-icon" aria-hidden="true">
          <Users size={20} />
        </span>
        <div className="preference-copy">
          <h2>Role-based operational alerts</h2>
          <p>Venue staff and admins see arrivals, inventory and finance alerts in their workspace according to their role. These are not switchable here.</p>
        </div>
        <StatusPill tone="neutral">By role</StatusPill>
      </Card>

      <div className="preference-actions">
        <Button type="submit" loading={busy} disabled={!dirty} data-testid="save-preferences">
          Save notification preferences
        </Button>
        {message ? (
          <p className={message.tone === "ok" ? "status-success" : "status-error"} role={message.tone === "ok" ? "status" : "alert"} data-testid="preferences-message">
            {message.text}
          </p>
        ) : null}
      </div>
    </form>
  );
}
