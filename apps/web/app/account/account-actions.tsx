"use client";

// Terms, privacy and session actions for the account column (Figma "Contact preferences" card position). Deletion is a
// request reviewed by support, not immediate erasure.
import { useState } from "react";
import { Button, Card } from "../../components/ui";

type Props = { termsRequired: boolean; termsVersion: string; privacyVersion: string; deletionPending: boolean };

export function AccountActions({ termsRequired, termsVersion, privacyVersion, deletionPending }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function call(path: string, body?: unknown) {
    setBusy(true);
    setMessage(null);
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    setBusy(false);
    const json = (await response.json().catch(() => ({}))) as { data?: { status?: string }; error?: { code?: string; message?: string } };
    return { ok: response.ok, status: response.status, json };
  }

  async function signOut() {
    await call("/api/v1/auth/sign-out");
    window.location.assign("/");
  }

  async function accept() {
    const result = await call("/api/v1/me/terms", { terms_version: termsVersion, privacy_version: privacyVersion });
    if (result.ok) window.location.reload();
    else setMessage(result.json.error?.message ?? "Could not record acceptance.");
  }

  async function requestDeletion() {
    const result = await call("/api/v1/privacy-requests", { kind: "DELETE" });
    if (result.ok) {
      setMessage(`Deletion request received (status: ${result.json.data?.status ?? "REQUESTED"}). New bookings are paused.`);
      window.setTimeout(() => window.location.reload(), 1500);
    } else if (result.json.error?.code === "REAUTH_REQUIRED") {
      setMessage("For your security, sign in again with a fresh code, then request deletion.");
    } else {
      setMessage(result.json.error?.message ?? "Could not create the request.");
    }
  }

  return (
    <>
      {termsRequired ? (
        <Card className="book-card" aria-labelledby="terms-heading">
          <h2 id="terms-heading">Terms</h2>
          <p className="book-when">Accept the current draft terms ({termsVersion}) and privacy notice before booking. Synthetic preview text.</p>
          <Button type="button" onClick={accept} disabled={busy}>
            Accept terms
          </Button>
        </Card>
      ) : null}

      <Card className="book-card" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading">Privacy &amp; session</h2>
        <dl className="detail-rows">
          <div>
            <dt>Essential booking messages</dt>
            <dd>Always on</dd>
          </div>
          <div>
            <dt>Marketing</dt>
            <dd>Not sent</dd>
          </div>
        </dl>
        <p className="field-hint">Essential transaction and security messages use your verified email.</p>
        {deletionPending ? (
          <p className="book-when" data-testid="deletion-pending">
            A deletion request is in review. New bookings are paused.
          </p>
        ) : confirmDelete ? (
          <>
            <p className="book-when">
              Requesting deletion pauses new bookings straight away. Active bookings, payments and refunds are reviewed first, and records we must
              keep for finance or audit are kept in pseudonymous form. This is a request, not immediate erasure.
            </p>
            <Button variant="danger" type="button" onClick={requestDeletion} disabled={busy}>
              Confirm deletion request
            </Button>
            <Button variant="secondary" type="button" onClick={() => setConfirmDelete(false)}>
              Keep my account
            </Button>
          </>
        ) : (
          <button className="text-link" type="button" onClick={() => setConfirmDelete(true)}>
            Privacy &amp; data requests →
          </button>
        )}
        <Button variant="secondary" type="button" onClick={signOut} disabled={busy}>
          Sign out
        </Button>
        {message ? (
          <p className="book-when" role="status" aria-live="polite">
            {message}
          </p>
        ) : null}
      </Card>
    </>
  );
}
