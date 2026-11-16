"use client";

// P03. Each section saves on its own (expected_version guards against edits from another tab). Published rules never
// change: edits go to a draft, which is reviewed with the venue or, for a live venue, on its own.
import { useState, type FormEvent } from "react";
import { AMENITY_CODES, CATEGORY_CODES, ENVIRONMENT_TAGS, REQUIREMENT_TAGS } from "@simply-sit/contracts";
import { tagLabel } from "../../../lib/labels";
import { GAP_LABEL, VENUE_STATUS_LABEL, type VenueOverview } from "../../../lib/partner-types";
import { useAction, type ActionMessage } from "../../../lib/use-action";

function Status({ message }: { message: ActionMessage | null }) {
  return message ? (
    <p className={`status-${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
      {message.text}
    </p>
  ) : null;
}

const POLICY_NUMBERS = [
  ["cancel_cutoff_minutes", "Free cancellation until (minutes before start)"],
  ["minimum_minutes", "Shortest booking (minutes)"],
  ["maximum_minutes", "Longest booking (minutes)"],
  ["buffer_minutes", "Cleaning time between bookings (minutes)"],
  ["grace_minutes", "Late arrival grace (minutes)"],
  ["lead_minutes", "Minimum notice before a booking starts (minutes)"],
  ["max_horizon_days", "Bookable how many days ahead"],
  ["end_reminder_minutes", "Reminder before the end (minutes)"]
] as const;
const PERCENTS = [
  ["early_refund_bps", "Refund if cancelled before the cutoff (%)"],
  ["late_refund_bps", "Refund if cancelled after the cutoff (%)"],
  ["no_show_refund_bps", "Refund for a no-show (%)"]
] as const;

const PILOT_DEFAULTS = {
  byo_food: "NOT_ALLOWED", outside_delivery: "NOT_ALLOWED", cancel_cutoff_minutes: 120, early_refund_bps: 10000, late_refund_bps: 0,
  no_show_refund_bps: 0, minimum_minutes: 60, increment_minutes: 30, maximum_minutes: 240, buffer_minutes: 10, grace_minutes: 15,
  lead_minutes: 15, max_horizon_days: 30, end_reminder_minutes: 10
};

export function VenueEditor({ overview }: { overview: VenueOverview }) {
  const v = overview.venue;
  const base = `/api/v1/partner/venues/${v.id}`;
  const profile = useAction();
  const rules = useAction();
  const catalogue = useAction();
  const photos = useAction();
  const submit = useAction();

  const [p, setP] = useState({ name: v.name, description: v.description, address: v.address, locality: v.locality, category_code: v.category_code,
                                 lat: String(v.lat), lng: String(v.lng) });
  // A new venue starts from the pilot defaults the database applies (shown, so the manager sees what customers get).
  const policySource = (overview.draft_policy ?? overview.active_policy ?? PILOT_DEFAULTS) as Record<string, unknown>;
  const [rule, setRule] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const k of ["byo_food", "byo_details", "outside_delivery", "handover_instructions", "house_rules"]) out[k] = String(policySource[k] ?? "");
    for (const [k] of POLICY_NUMBERS) out[k] = policySource[k] === undefined ? "" : String(policySource[k]);
    out.increment_minutes = policySource.increment_minutes === undefined ? "30" : String(policySource.increment_minutes);
    for (const [k] of PERCENTS) out[k] = policySource[k] === undefined ? "" : String(Number(policySource[k]) / 100);
    if (!out.byo_food) out.byo_food = "NOT_ALLOWED";
    if (!out.outside_delivery) out.outside_delivery = "NOT_ALLOWED";
    return out;
  });
  const [amenities, setAmenities] = useState<Record<string, { on: boolean; details: string }>>(() =>
    Object.fromEntries(AMENITY_CODES.map((c) => {
      const a = overview.amenities.find((x) => x.code === c);
      return [c, { on: !!a, details: a?.details ?? "" }];
    })));
  const [tags, setTags] = useState<Set<string>>(() => new Set(overview.tags.map((t) => `${t.group}:${t.code}`)));
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [uploadState, setUploadState] = useState<ActionMessage | null>(null);
  const live = v.status === "PUBLISHED" || v.status === "PAUSED";
  const editable = v.status === "DRAFT" || live;

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    await profile.run("profile", "PATCH", base, {
      name: p.name, description: p.description, address: p.address, locality: p.locality, category_code: p.category_code,
      lat: Number(p.lat), lng: Number(p.lng), expected_version: v.version
    }, { success: "Profile saved." });
  }

  async function saveRules(event: FormEvent) {
    event.preventDefault();
    const body: Record<string, unknown> = {
      byo_food: rule.byo_food, byo_details: rule.byo_details, outside_delivery: rule.outside_delivery,
      handover_instructions: rule.handover_instructions, house_rules: rule.house_rules, increment_minutes: Number(rule.increment_minutes)
    };
    for (const [k] of POLICY_NUMBERS) if (rule[k] !== "") body[k] = Number(rule[k]);
    for (const [k] of PERCENTS) if (rule[k] !== "") body[k] = Math.round(Number(rule[k]) * 100);
    await rules.run("rules", "POST", `${base}/policies`, body, { success: live ? "Draft saved. Send it for review to apply it." : "Rules saved." });
  }

  async function saveCatalogue(event: FormEvent) {
    event.preventDefault();
    await catalogue.run("catalogue", "PUT", `${base}/amenities-and-tags`, {
      amenities: AMENITY_CODES.filter((c) => amenities[c]!.on).map((c) => (amenities[c]!.details.trim() ? { code: c, details: amenities[c]!.details.trim() } : { code: c })),
      tags: [...tags].map((t) => {
        const [group, code] = t.split(":");
        return { group, code };
      }),
      expected_version: v.version
    }, { success: "Amenities and uses saved." });
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    const data = new FormData();
    data.set("file", file);
    data.set("alt_text", alt);
    photos.clear();
    setUploadState({ tone: "warning", text: "Uploading..." });
    // Multipart upload: the shared JSON helper cannot send files, so this one call uses fetch directly.
    const response = await fetch(`${base}/media`, { method: "POST", body: data, credentials: "same-origin" }).catch(() => null);
    if (response?.ok) {
      window.location.reload();
      return;
    }
    const json = (await response?.json().catch(() => null)) as { error?: { message: string; details?: { reason?: string } } } | null;
    const reason = json?.error?.details?.reason;
    setUploadState({
      tone: "error",
      text: reason === "type" ? "That file is not a JPEG, PNG or WebP image." : reason === "size" || reason === "too_large"
        ? "That photo is larger than 5 MB." : json?.error?.message ?? "Upload failed. Check your connection and try again."
    });
  }

  return (
    <>
      <section className="card" aria-labelledby="listing-heading" data-testid="listing-status">
        <h2 id="listing-heading">{v.name}</h2>
        <p>
          <strong>{VENUE_STATUS_LABEL[v.status] ?? v.status}</strong>
          {v.is_synthetic ? <span className="badge">Synthetic demo venue</span> : null}
        </p>
        {v.status_reason ? <p className="status-warning">Reason from Simply Sit: {v.status_reason}</p> : null}
        {v.status === "DRAFT" ? (
          overview.publication_gaps.length > 0 ? (
            <>
              <p>Still needed before review:</p>
              <ul data-testid="publication-gaps">
                {overview.publication_gaps.map((g) => (
                  <li key={g}>{GAP_LABEL[g] ?? g}</li>
                ))}
              </ul>
            </>
          ) : (
            <button className="button" type="button" disabled={submit.busy !== null} data-testid="submit-venue"
              onClick={() => void submit.run("submit", "POST", `${base}/submit`, { expected_version: v.version }, { success: "Sent for review." })}>
              Send for review
            </button>
          )
        ) : null}
        <Status message={submit.message} />
      </section>

      <form className="card" style={{ marginTop: 16 }} onSubmit={(e) => void saveProfile(e)} aria-labelledby="profile-heading">
        <h2 id="profile-heading">Profile</h2>
        <fieldset disabled={!editable}>
          <label htmlFor="v-name">Name</label>
          <input id="v-name" className="input" required value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
          <label htmlFor="v-category">Type</label>
          <select id="v-category" className="input" value={p.category_code} onChange={(e) => setP({ ...p, category_code: e.target.value })}>
            {CATEGORY_CODES.map((c) => (
              <option key={c} value={c}>
                {tagLabel(c)}
              </option>
            ))}
          </select>
          <label htmlFor="v-description">Description (what it is like to sit here)</label>
          <textarea id="v-description" className="input" rows={4} maxLength={3000} value={p.description}
            onChange={(e) => setP({ ...p, description: e.target.value })} data-testid="venue-description" />
          <label htmlFor="v-address">Address</label>
          <input id="v-address" className="input" required value={p.address} onChange={(e) => setP({ ...p, address: e.target.value })} />
          <label htmlFor="v-locality">Area</label>
          <input id="v-locality" className="input" required value={p.locality} onChange={(e) => setP({ ...p, locality: e.target.value })} />
          <div className="field-row">
            <label>
              Latitude
              <input className="input" inputMode="decimal" value={p.lat} onChange={(e) => setP({ ...p, lat: e.target.value })} />
            </label>
            <label>
              Longitude
              <input className="input" inputMode="decimal" value={p.lng} onChange={(e) => setP({ ...p, lng: e.target.value })} />
            </label>
          </div>
          <button className="button" type="submit" disabled={profile.busy !== null} data-testid="save-profile">
            Save profile
          </button>
        </fieldset>
        <Status message={profile.message} />
      </form>

      <form className="card" style={{ marginTop: 16 }} onSubmit={(e) => void saveRules(e)} aria-labelledby="rules-heading">
        <h2 id="rules-heading">Food, cancellation and house rules</h2>
        {live && overview.draft_policy?.submitted_at ? <p className="notice">A change is waiting for Simply Sit review.</p> : null}
        {overview.draft_policy?.review_reason ? <p className="status-warning">Changes requested: {overview.draft_policy.review_reason}</p> : null}
        <fieldset disabled={!editable || !!overview.draft_policy?.submitted_at}>
          <label htmlFor="r-byo">Outside food</label>
          <select id="r-byo" className="input" value={rule.byo_food} onChange={(e) => setRule({ ...rule, byo_food: e.target.value })}>
            <option value="ALLOWED">Allowed</option>
            <option value="RESTRICTED">Restricted</option>
            <option value="NOT_ALLOWED">Not allowed</option>
          </select>
          <label htmlFor="r-byo-details">Outside food details customers see</label>
          <input id="r-byo-details" className="input" value={rule.byo_details} onChange={(e) => setRule({ ...rule, byo_details: e.target.value })} />
          <label htmlFor="r-delivery">Outside delivery</label>
          <select id="r-delivery" className="input" value={rule.outside_delivery} onChange={(e) => setRule({ ...rule, outside_delivery: e.target.value })}>
            <option value="ALLOWED">Allowed</option>
            <option value="RESTRICTED">Restricted</option>
            <option value="NOT_ALLOWED">Not allowed</option>
          </select>
          <label htmlFor="r-handover">On arrival</label>
          <input id="r-handover" className="input" value={rule.handover_instructions} onChange={(e) => setRule({ ...rule, handover_instructions: e.target.value })} />
          <label htmlFor="r-house">House rules</label>
          <textarea id="r-house" className="input" rows={3} value={rule.house_rules} onChange={(e) => setRule({ ...rule, house_rules: e.target.value })} />
          <label htmlFor="r-increment">Booking step (minutes)</label>
          <select id="r-increment" className="input" value={rule.increment_minutes} onChange={(e) => setRule({ ...rule, increment_minutes: e.target.value })}>
            <option value="15">15</option>
            <option value="30">30</option>
            <option value="60">60</option>
          </select>
          {POLICY_NUMBERS.map(([k, label]) => (
            <label key={k}>
              {label}
              <input className="input" inputMode="numeric" value={rule[k]} onChange={(e) => setRule({ ...rule, [k]: e.target.value })} />
            </label>
          ))}
          {PERCENTS.map(([k, label]) => (
            <label key={k}>
              {label}
              <input className="input" inputMode="decimal" value={rule[k]} onChange={(e) => setRule({ ...rule, [k]: e.target.value })} />
            </label>
          ))}
          <p className="food-note">Customers keep the rules they accepted when they booked; changes apply to new bookings only.</p>
          <button className="button" type="submit" disabled={rules.busy !== null} data-testid="save-rules">
            {live ? "Save draft" : "Save rules"}
          </button>
          {live && overview.draft_policy && !overview.draft_policy.submitted_at ? (
            <button className="button secondary" type="button" disabled={rules.busy !== null} style={{ marginLeft: 8 }}
              onClick={() => void rules.run("submit-policy", "POST", `${base}/policies/${overview.draft_policy!.id}/submit`,
                { expected_version: overview.draft_policy!.version }, { success: "Sent for review." })}>
              Send rule change for review
            </button>
          ) : null}
        </fieldset>
        <Status message={rules.message} />
      </form>

      <form className="card" style={{ marginTop: 16 }} onSubmit={(e) => void saveCatalogue(e)} aria-labelledby="amenities-heading">
        <h2 id="amenities-heading">Good for and amenities</h2>
        <fieldset disabled={!editable}>
          <legend>Good for</legend>
          <div className="chips">
            {REQUIREMENT_TAGS.map((code) => (
              <label key={code}>
                <input type="checkbox" checked={tags.has(`REQUIREMENT:${code}`)} data-testid={`tag-${code}`}
                  onChange={(e) => setTags((t) => { const n = new Set(t); if (e.target.checked) n.add(`REQUIREMENT:${code}`); else n.delete(`REQUIREMENT:${code}`); return n; })} />{" "}
                {tagLabel(code)}
              </label>
            ))}
          </div>
          <legend>Atmosphere</legend>
          <div className="chips">
            {ENVIRONMENT_TAGS.map((code) => (
              <label key={code}>
                <input type="checkbox" checked={tags.has(`ENVIRONMENT:${code}`)}
                  onChange={(e) => setTags((t) => { const n = new Set(t); if (e.target.checked) n.add(`ENVIRONMENT:${code}`); else n.delete(`ENVIRONMENT:${code}`); return n; })} />{" "}
                {tagLabel(code)}
              </label>
            ))}
          </div>
          <legend>Amenities</legend>
          {AMENITY_CODES.map((code) => (
            <div key={code}>
              <label>
                <input type="checkbox" checked={amenities[code]!.on}
                  onChange={(e) => setAmenities({ ...amenities, [code]: { ...amenities[code]!, on: e.target.checked } })} /> {tagLabel(code)}
              </label>
              {code.startsWith("ACCESSIBLE") && amenities[code]!.on ? (
                <input className="input" placeholder="Describe it (verified by Simply Sit)" value={amenities[code]!.details}
                  onChange={(e) => setAmenities({ ...amenities, [code]: { ...amenities[code]!, details: e.target.value } })} />
              ) : null}
            </div>
          ))}
          <button className="button" type="submit" disabled={catalogue.busy !== null} data-testid="save-catalogue">
            Save
          </button>
        </fieldset>
        <Status message={catalogue.message} />
      </form>

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="photos-heading">
        <h2 id="photos-heading">Photos</h2>
        <p className="food-note">JPEG, PNG or WebP up to 5 MB. Photos stay private until Simply Sit approves them.</p>
        {overview.media.length > 0 ? (
          <div className="photo-strip" data-testid="partner-photos">
            {overview.media.map((m) => (
              <figure key={m.id} style={{ margin: 0 }}>
                <img src={`/api/v1/media/${m.id}`} alt={m.alt_text} width={240} height={150} style={{ width: 240, height: 150, objectFit: "cover" }} />
                <figcaption>
                  {m.status === "APPROVED" ? "Approved" : m.status === "PENDING" ? "Waiting for approval" : "Not approved"} ·{" "}
                  <button type="button" className="button secondary" disabled={photos.busy !== null}
                    onClick={() => void photos.run(m.id, "DELETE", `/api/v1/partner/media/${m.id}`, undefined, { success: "Photo removed." })}>
                    Remove
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : null}
        <form className="inline-form" onSubmit={(e) => void upload(e)}>
          <label>
            Photo
            <input type="file" accept="image/jpeg,image/png,image/webp" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="photo-file" />
          </label>
          <label>
            Describe the photo (for screen readers)
            <input className="input" required minLength={3} maxLength={250} value={alt} onChange={(e) => setAlt(e.target.value)} data-testid="photo-alt" />
          </label>
          <button className="button" type="submit" disabled={!editable || !file} data-testid="photo-upload">
            Upload
          </button>
        </form>
        <Status message={uploadState ?? photos.message} />
      </section>
    </>
  );
}
