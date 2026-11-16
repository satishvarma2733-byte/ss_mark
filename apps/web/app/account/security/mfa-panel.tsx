"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, ButtonLink, Card } from "../../../components/ui";

type Status = { aal: string; factors: { id: string; status: string }[] };
type Enrollment = { factor_id: string; qr_code: string; secret: string };

export function MfaPanel({ redirectPath }: { redirectPath: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/auth/mfa")
      .then((r) => r.json())
      .then((j: { data?: Status }) => setStatus(j.data ?? null))
      .catch(() => setMessage("Could not load authenticator status."));
  }, []);

  const verified = status?.factors.find((f) => f.status === "verified");
  const factorId = enrollment?.factor_id ?? verified?.id;

  async function enroll() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/v1/auth/mfa/enroll", { method: "POST" });
    const json = (await response.json()) as { data?: Enrollment; error?: { message?: string } };
    setBusy(false);
    if (response.ok && json.data) setEnrollment(json.data);
    else setMessage(json.error?.message ?? "Could not start enrolment.");
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/v1/auth/mfa/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ factor_id: factorId, code })
    });
    setBusy(false);
    if (response.ok) window.location.assign(redirectPath);
    else setMessage("That code did not work. Check the time on your device and try again.");
  }

  if (!status) return <p className="skeleton" aria-label="Loading authenticator status" />;
  if (status.aal === "aal2") {
    return (
      <Card>
        <p data-testid="mfa-verified">This session is verified with your authenticator.</p>
        <ButtonLink href={redirectPath}>
          Continue
        </ButtonLink>
      </Card>
    );
  }

  return (
    <Card style={{ maxWidth: 520 }}>
      {!verified && !enrollment ? (
        <>
          <p>Add Simply Sit to an authenticator app (for example, one that supports standard 6-digit time-based codes).</p>
          <Button type="button" onClick={enroll} disabled={busy}>
            Set up authenticator
          </Button>
        </>
      ) : null}
      {enrollment ? (
        <>
          <p>Scan this code with your authenticator app, or enter the key manually.</p>
          <img src={enrollment.qr_code} alt="Authenticator QR code" width={180} height={180} />
          <p>
            Key: <code data-testid="mfa-secret">{enrollment.secret}</code>
          </p>
        </>
      ) : null}
      {factorId ? (
        <form onSubmit={verify}>
          <label htmlFor="totp">6-digit authenticator code</label>
          <input id="totp" className="input" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          <p>
            <Button type="submit" disabled={busy}>
              Verify
            </Button>
          </p>
        </form>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </Card>
  );
}
