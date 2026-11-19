"use client";

import { useState, type FormEvent } from "react";
import { Check, CircleAlert } from "lucide-react";
import { formatVenueDateTime } from "../../../../lib/format";
import { useAction, type Conflict } from "../../../../lib/use-action";
import { VenuePhoto } from "../../../../components/venue-photo";
import { Button, Card } from "../../../../components/ui";

export type AdminVenue = {
  venue: { id: string; name: string; description: string; address: string; locality: string; category_code: string; status: string;
           status_reason: string | null; submitted_at: string | null; version: number; is_synthetic: boolean; lat: number; lng: number };
  partner: { legal_name: string; status: string } | null;
  owners: string[];
  active_policy: Record<string, unknown> | null;
  draft_policy: (Record<string, unknown> & { id: string; version: number; submitted_at: string | null }) | null;
  resources: { label: string; capacity: number; status: string; hourly_paise: number | null }[];
  hours: { weekday: number; opens_local: string; closes_local: string }[];
  media: { id: string; alt_text: string; status: string; kind?: "PHOTO" | "LOGO" }[];
  amenities: { code: string; details: string | null }[];
  tags: { group: string; code: string }[];
  publication_gaps: string[];
  history: { action: string; reason: string | null; at: string; actor_role: string }[];
};

const DECISIONS: Record<string, [string, string][]> = {
  PENDING_REVIEW: [["APPROVE", "Approve and publish"], ["REQUEST_CHANGES", "Request changes"], ["REJECT", "Reject"]],
  PUBLISHED: [["PAUSE", "Pause new bookings"]],
  PAUSED: [["RESUME", "Resume"]]
};

const MEDIA_TONE: Record<string, string> = { APPROVED: "", PENDING: " warm", REJECTED: " danger" };

// Figma "Admin · Partner review" right column: photos, rule change and "Record your decision" cards.
export function ReviewPanel({ detail }: { detail: AdminVenue }) {
  const review = useAction();
  const media = useAction();
  const policy = useAction();
  const options = DECISIONS[detail.venue.status] ?? [];
  const [decision, setDecision] = useState(options[0]?.[0] ?? "");
  const [reason, setReason] = useState("");
  const [policyReason, setPolicyReason] = useState("");
  const [affected, setAffected] = useState<Conflict[]>([]);

  async function decide(event: FormEvent) {
    event.preventDefault();
    const result = await review.run<{ affected_bookings: Conflict[] }>("review", "POST", `/api/v1/admin/venues/${detail.venue.id}/review`,
      { decision, reason, expected_version: detail.venue.version }, { idempotent: true, success: "Decision recorded." });
    if (result.ok) setAffected(result.data.affected_bookings ?? []);
  }

  return (
    <>
      <Card aria-labelledby="photos-heading">
        <div className="section-heading stacked">
          <h2 id="photos-heading">Photos and logo</h2>
          {detail.venue.status === "PENDING_REVIEW" ? <p className="small">Approving the listing approves its pending photos and logo.</p> : null}
        </div>
        {detail.media.length === 0 ? <p className="notice">No photos.</p> : (
          <ul className="review-photos">
            {detail.media.map((m) => (
              <li key={m.id}>
                <figure>
                  <VenuePhoto mediaId={m.id} alt={m.alt_text} className="review-photo" width={240} height={150} />
                  <figcaption>
                    <span className="small">{m.kind === "LOGO" ? <strong data-testid="review-logo">Logo · </strong> : null}{m.alt_text}</span>
                    <span className={`status-pill${MEDIA_TONE[m.status] ?? " neutral"}`}>{m.status.toLowerCase()}</span>
                  </figcaption>
                </figure>
                {m.status === "PENDING" && detail.venue.status !== "PENDING_REVIEW" ? (
                  <div className="row-buttons">
                    <Button variant="secondary" type="button" disabled={media.busy !== null}
                      onClick={() => void media.run(m.id, "POST", `/api/v1/admin/media/${m.id}/review`, { decision: "APPROVE" }, { success: m.kind === "LOGO" ? "Logo approved. It replaces the previous logo." : "Photo approved." })}>
                      Approve
                    </Button>
                    <Button variant="secondary" type="button" disabled={media.busy !== null}
                      onClick={() => void media.run(m.id, "POST", `/api/v1/admin/media/${m.id}/review`, { decision: "REJECT" }, { success: m.kind === "LOGO" ? "Logo rejected." : "Photo rejected." })}>
                      Reject
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {media.message ? <p className={`status-${media.message.tone}`} role="status">{media.message.text}</p> : null}
      </Card>

      {detail.draft_policy?.submitted_at ? (
        <Card aria-labelledby="policy-heading">
          <div className="section-heading stacked">
            <h2 id="policy-heading">Rule change submitted {formatVenueDateTime(detail.draft_policy.submitted_at)} IST</h2>
            <p className="small">Applies to new bookings only once approved.</p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="policy-reason">Reason (recorded)</label>
            <input id="policy-reason" className="input" value={policyReason} onChange={(e) => setPolicyReason(e.target.value)} minLength={3} />
          </div>
          <div className="row-buttons">
            <Button type="button" disabled={policy.busy !== null || policyReason.trim().length < 3}
              onClick={() => void policy.run("approve", "POST", `/api/v1/admin/policies/${detail.draft_policy!.id}/review`,
                { decision: "APPROVE", reason: policyReason, expected_version: detail.draft_policy!.version }, { success: "Rule change published." })}>
              Approve rule change
            </Button>
            <Button variant="secondary" type="button" disabled={policy.busy !== null || policyReason.trim().length < 3}
              onClick={() => void policy.run("return", "POST", `/api/v1/admin/policies/${detail.draft_policy!.id}/review`,
                { decision: "REQUEST_CHANGES", reason: policyReason, expected_version: detail.draft_policy!.version }, { success: "Returned to the venue." })}>
              Request changes
            </Button>
          </div>
          {policy.message ? <p className={`status-${policy.message.tone}`} role="status">{policy.message.text}</p> : null}
        </Card>
      ) : null}

      {options.length > 0 ? (
        <form className="card" onSubmit={(e) => void decide(e)} aria-labelledby="decision-heading">
          <h2 id="decision-heading">Record your decision</h2>
          <div className="field">
            <label className="field-label" htmlFor="review-reason">Review reason · required for all decisions</label>
            <textarea id="review-reason" className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={500}
              placeholder="What you checked and why" data-testid="review-reason" />
          </div>
          <fieldset className="decision-options">
            <legend className="visually-hidden">Decision</legend>
            {options.map(([value, label]) => (
              <label key={value} className="chip">
                <input type="radio" name="decision" value={value} checked={decision === value} onChange={() => setDecision(value)} data-testid={`decision-${value}`} />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="row-buttons">
            <Button type="submit" disabled={review.busy !== null} data-testid="review-submit">
              <Check size={18} aria-hidden="true" />
              Record decision
            </Button>
          </div>
          <p className="fine-print">
            Every decision records the reviewer, reason, time and the reviewed listing version. The reason is shown to the venue for changes, pauses and
            rejections.
          </p>
          {review.message ? <p className={`status-${review.message.tone}`} role="status">{review.message.text}</p> : null}
          {affected.length > 0 ? (
            <div className="notice warm" role="alert">
              <CircleAlert size={18} aria-hidden="true" />
              <div>
                <strong>Future bookings to assess (nothing was cancelled)</strong>
                <ul className="plain-list">
                  {affected.map((a) => (
                    <li key={a.public_ref}>
                      {a.public_ref} · {a.resource_label} · {a.starts_at ? formatVenueDateTime(a.starts_at) : ""} IST
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </form>
      ) : null}
    </>
  );
}
