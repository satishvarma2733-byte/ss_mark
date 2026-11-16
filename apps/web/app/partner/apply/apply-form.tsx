"use client";

// Figma "C · Partner desktop · New-partner onboarding": business and venue cards beside setup progress, secure
// verification and the save action. Only the fields the application API stores are collected.
import { useState, type FormEvent } from "react";
import { Check, Clock3 } from "lucide-react";
import { CATEGORY_CODES, PILOT_AREAS } from "@simply-sit/contracts";
import { tagLabel } from "../../../lib/labels";
import { useAction } from "../../../lib/use-action";

const STEPS = [
  { title: "Business & contact", detail: "Registered name on this form" },
  { title: "Venue location", detail: "Name, type and address on this form" },
  { title: "Tables, rates & policies", detail: "Next, on your venue profile" },
  { title: "Owner verification", detail: "Secure provider check, after review" },
  { title: "Payout setup", detail: "Owner only · Secure provider" }
];

export function ApplyForm() {
  const action = useAction();
  const [area, setArea] = useState<string>(PILOT_AREAS[0].code);
  const [authorised, setAuthorised] = useState(false);
  const [form, setForm] = useState<{ partner_legal_name: string; venue_name: string; category_code: string; address: string; locality: string }>(
    { partner_legal_name: "", venue_name: "", category_code: "CAFE", address: "", locality: PILOT_AREAS[0].label });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const done = [form.partner_legal_name.trim().length >= 2, form.venue_name.trim().length >= 2 && form.address.trim().length >= 5];

  async function submit(event: FormEvent) {
    event.preventDefault();
    const centre = PILOT_AREAS.find((a) => a.code === area)!;
    // The area centre is a starting point; the exact pin can be corrected on the venue page.
    const result = await action.run<{ venue_id: string }>("apply", "POST", "/api/v1/partner/applications",
      { ...form, lat: centre.lat, lng: centre.lng }, { idempotent: true, refresh: false });
    if (result.ok) window.location.assign(`/partner/venue?venue=${result.data.venue_id}`);
  }

  return (
    <form className="partner-layout" onSubmit={(e) => void submit(e)} data-testid="apply-form">
      <div className="book-main">
        <section className="card book-card" aria-labelledby="business-heading">
          <h2 id="business-heading">Business &amp; contact</h2>
          <div className="field">
            <label className="field-label" htmlFor="legal">
              Registered business name
            </label>
            <input id="legal" className="input" required minLength={2} maxLength={200} value={form.partner_legal_name}
              onChange={(e) => set({ partner_legal_name: e.target.value })} autoComplete="organization" />
          </div>
          <p className="field-hint">We contact you through your signed-in account. Registration documents are requested during review, not here.</p>
        </section>

        <section className="card book-card" aria-labelledby="venue-heading">
          <h2 id="venue-heading">Venue &amp; location</h2>
          {/* Illustrative photograph from the Figma frame; your own photos are added on the venue profile. */}
          <img className="apply-photo" src="/design/sign-in-venue.jpg" alt="" width={1584} height={672} />
          <div className="field-pair">
            <div className="field">
              <label className="field-label" htmlFor="venue-name">
                Venue name customers will see
              </label>
              <input id="venue-name" className="input" required minLength={2} maxLength={120} value={form.venue_name}
                onChange={(e) => set({ venue_name: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="category">
                Category
              </label>
              <select id="category" className="input" value={form.category_code} onChange={(e) => set({ category_code: e.target.value })}>
                {CATEGORY_CODES.map((c) => (
                  <option key={c} value={c}>
                    {tagLabel(c)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="address">
              Street address
            </label>
            <input id="address" className="input" required minLength={5} maxLength={300} value={form.address}
              onChange={(e) => set({ address: e.target.value })} autoComplete="street-address" />
          </div>
          <div className="field-pair">
            <div className="field">
              <label className="field-label" htmlFor="area">
                Area (pilot service area)
              </label>
              <select id="area" className="input" value={area} onChange={(e) => {
                setArea(e.target.value);
                set({ locality: PILOT_AREAS.find((a) => a.code === e.target.value)!.label });
              }}>
                {PILOT_AREAS.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <span className="field-label" id="tz-label">
                Timezone
              </span>
              <p className="input input-static" aria-labelledby="tz-label">
                Asia/Kolkata · IST
              </p>
            </div>
          </div>
          <p className="book-note">Table-only reservations. Tables, rates, hours and policies are set in the next step and reviewed with the listing.</p>
        </section>
      </div>

      <div className="book-side">
        <section className="card book-card" aria-labelledby="progress-heading">
          <h2 id="progress-heading">Setup progress</h2>
          <span className="status-pill sage">
            <img src="/design/status-dot-brand.svg" alt="" width={5} height={5} />
            Draft · {done.filter(Boolean).length} of 5 complete
          </span>
          <ol className="stay-timeline">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className={`marker ${done[i] ? "done" : "wait"}`} aria-hidden="true">
                  {done[i] ? <Check size={13} /> : <Clock3 size={13} />}
                </span>
                <div>
                  <strong>{s.title}</strong>
                  <p>{done[i] ? "Ready to save" : s.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className="card book-card" aria-labelledby="verify-heading">
          <h2 id="verify-heading">Secure verification</h2>
          <p className="book-when">
            Owner identity and payouts are set up directly with our payment provider after review. Never send bank details in support messages.
          </p>
          <span className="status-pill warm">Provider KYC · Not started</span>
        </section>
        <label className="check-row">
          <input type="checkbox" checked={authorised} onChange={(e) => setAuthorised(e.target.checked)} required />
          <span>I’m authorised to represent this venue and accept the partner terms.</span>
        </label>
        {action.message ? (
          <p className={`book-when status-${action.message.tone}`} role="alert">
            {action.message.text}
          </p>
        ) : null}
        <button className="button" type="submit" disabled={action.busy !== null || !authorised} aria-busy={action.busy === "apply"} data-testid="apply-submit">
          {action.busy ? "Creating draft…" : "Save & continue"}
        </button>
        <p className="field-hint">Simply Sit reviews every listing before it goes live. Your listing stays unpublished until approved.</p>
      </div>
    </form>
  );
}
