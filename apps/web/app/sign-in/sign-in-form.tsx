"use client";

// Figma "E · Customer web · Sign-in and OTP": an entry card, then a code card with six digit boxes, an error notice and
// a resend countdown. The digit boxes mirror one real input, so typing, pasting and one-time-code autofill all work.
import { useEffect, useRef, useState, type FormEvent } from "react";

type ApiError = { error?: { code?: string; message?: string } };
type RequestData = { data?: { resend_after_seconds?: number } };

async function post(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await response.json().catch(() => ({}))) as ApiError & RequestData;
  return { ok: response.ok, json };
}

function maskEmail(email: string) {
  const [name = "", domain = ""] = email.split("@");
  return domain ? `${name.slice(0, 1)}••••••@${domain}` : email;
}

function countdown(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function SignInForm({ redirectPath }: { redirectPath: string }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  async function sendCode() {
    setBusy(true);
    setMessage(null);
    setCodeError(null);
    const { ok, json } = await post("/api/v1/auth/otp/request", { email, intent: "sign_in", redirect_path: redirectPath });
    setBusy(false);
    if (ok) {
      setStep("code");
      setCode("");
      setResendIn(json.data?.resend_after_seconds ?? 60);
      setMessage("If this email can sign in, a code is on its way. It expires in 10 minutes.");
      codeInput.current?.focus();
    } else {
      setMessage(json.error?.message ?? "We could not send a code. Try again.");
    }
  }

  function requestCode(event: FormEvent) {
    event.preventDefault();
    void sendCode();
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setCodeError(null);
    const { ok, json } = await post("/api/v1/auth/otp/verify", { email, code, accept_terms: acceptTerms });
    setBusy(false);
    if (ok) {
      window.location.assign(redirectPath);
    } else if (json.error?.code === "VALIDATION_FAILED") {
      setCodeError("That code is not valid or has expired. Check the email and try again. You are not signed in yet.");
    } else {
      setMessage(json.error?.message ?? "Sign-in failed.");
    }
  }

  const digits = Array.from({ length: 6 }, (_, i) => code[i] ?? "");

  return (
    <div className="auth-forms">
      {step === "email" ? (
        <form className="card auth-card" onSubmit={requestCode}>
          <h2>Sign in / Create account</h2>
          <div className="field">
            <label className="field-label" htmlFor="email">
              Email address
            </label>
            <input id="email" name="email" type="email" autoComplete="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} className="input" aria-describedby="email-hint" />
            <p className="field-hint" id="email-hint">
              We’ll send a six-digit code.
            </p>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} />
            <span>I agree to the Terms of use and acknowledge the Privacy notice. Required before your first booking.</span>
          </label>
          <button className="button" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? "Sending…" : "Send verification code"}
          </button>
          <p className="field-hint">We ask only for details needed to secure your account and manage bookings.</p>
        </form>
      ) : (
        <form className="card auth-card" onSubmit={verifyCode}>
          <h2>Verify your email</h2>
          <p className="auth-sent">Sent to {maskEmail(email)}</p>
          <button className="text-link" type="button" onClick={() => { setStep("email"); setMessage(null); setCodeError(null); }}>
            Edit email →
          </button>
          <div className={`otp-field${codeError ? " invalid" : ""}`}>
            <label className="visually-hidden" htmlFor="code">
              6-digit code
            </label>
            <input ref={codeInput} autoFocus id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6}
              required value={code} aria-invalid={codeError ? true : undefined} aria-describedby={codeError ? "code-error" : undefined}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setCodeError(null); }} />
            <div className="otp-boxes" aria-hidden="true">
              {digits.map((digit, i) => (
                <span key={i} className={`otp-box${i === Math.min(code.length, 5) ? " current" : ""}`}>
                  {digit}
                </span>
              ))}
            </div>
          </div>
          {codeError ? (
            <div className="notice error" id="code-error" role="alert">
              <img src="/design/circle-alert-error.svg" alt="" width={20} height={20} />
              <div>
                <strong>Incorrect code</strong>
                <p>{codeError}</p>
              </div>
            </div>
          ) : null}
          <button className="button" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? "Checking…" : "Verify & continue"}
          </button>
          {resendIn > 0 ? (
            <p className="field-hint auth-resend">Resend code in {countdown(resendIn)}</p>
          ) : (
            <button className="text-link auth-resend" type="button" disabled={busy} onClick={() => void sendCode()}>
              Resend code
            </button>
          )}
        </form>
      )}
      {message ? (
        <p className="auth-message" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      <p className="field-hint">Never share your code. Simply Sit support will never ask for a verification code or UPI PIN.</p>
    </div>
  );
}
