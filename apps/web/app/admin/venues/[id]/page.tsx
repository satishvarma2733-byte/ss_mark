import { notFound } from "next/navigation";
import { BookOpen, Check as CheckIcon, CircleAlert, Info, SquareCheck } from "lucide-react";
import { adminVenueDetail, adminVenueQueue, asUser, DomainError, getDb } from "@simply-sit/db";
import { FOOD_RULE_LABEL, formatInrPaise, formatVenueDateTime } from "../../../../lib/format";
import { tagLabel } from "../../../../lib/labels";
import { GAP_LABEL, VENUE_STATUS_LABEL, WEEKDAY_NAMES } from "../../../../lib/partner-types";
import { gatePortal, PortalBlocked } from "../../../../lib/portal-page";
import { VenuePhoto } from "../../../../components/venue-photo";
import { ReviewPanel, type AdminVenue } from "./review-panel";
import { AdminNav } from "../../../../lib/admin-nav";
import { QUEUE_STATUSES, queueStatus, SubmissionList, type VenueQueueRow } from "../submission-list";

export const dynamic = "force-dynamic";

type Policy = Record<string, unknown>;

const foodLabel = (value: unknown) => FOOD_RULE_LABEL[value as keyof typeof FOOD_RULE_LABEL] ?? "-";
const pct = (bps: unknown) => `${Number(bps ?? 0) / 100}%`;

// "venue.review_approve" / "APPROVE" style audit codes read as a short sentence: "Venue review approve".
const actionLabel = (action: string) => {
  const words = action.replace(/[._]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// Same opening span every day reads as "Daily 08:00-22:00"; otherwise each day is listed.
function hoursSummary(hours: AdminVenue["hours"]) {
  if (hours.length === 0) return "No hours";
  const spans = new Set(hours.map((h) => `${h.opens_local}-${h.closes_local}`));
  if (spans.size === 1 && new Set(hours.map((h) => h.weekday)).size === 7) return `Daily ${[...spans][0]}`;
  return hours.map((h) => `${WEEKDAY_NAMES[h.weekday]?.slice(0, 3)} ${h.opens_local}-${h.closes_local}`).join(" · ");
}

const STATUS_TONE: Record<string, string> ={ PENDING_REVIEW: " sage", PUBLISHED: "", PAUSED: " warm", REJECTED: " danger", DRAFT: " neutral" };

// Rule lines shown side by side in "What changed in this submission".
function ruleLines(p: Policy): [string, string][] {
  return [
    ["Outside food", `${foodLabel(p.byo_food)}${p.byo_details ? ` · ${String(p.byo_details)}` : ""}`],
    ["Outside delivery", foodLabel(p.outside_delivery)],
    ["Cancellation", `${pct(p.early_refund_bps)} refund until ${String(p.cancel_cutoff_minutes ?? "-")} min before · ${pct(p.late_refund_bps)} after`],
    ["No-show", `${pct(p.no_show_refund_bps)} refund`],
    ["House rules", String(p.house_rules ?? "") || "None"]
  ];
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className={ok ? "ok" : "missing"}>
      {ok ? <SquareCheck size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
      <div>
        <strong>{label}</strong>
        <span>
          {ok ? "" : "Missing · "}
          {detail}
        </span>
      </div>
    </li>
  );
}

// A02 - application evidence (profile, rules, tables, hours, photos, amenities), history and the review decision.
// Approval publishes the listing; pausing stops new bookings and lists the future bookings needing assessment.
// Layout follows Figma "Admin · Partner review": the queue stays on the left with this submission selected.
export default async function AdminVenuePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; q?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const gate = await gatePortal(`/admin/venues/${id}`, (me) => me.platform_roles.some((r) => r === "SUPERADMIN" || r === "SUPPORT"));
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const query = await searchParams;
  const detail = (await asUser(getDb(), gate.identity.claims, (tx) => adminVenueDetail(tx, id)).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  })) as AdminVenue;
  const v = detail.venue;
  // The queue shown beside the detail defaults to this venue's own status so the selected card is visible.
  const status = query.status ? queueStatus(query.status) : QUEUE_STATUSES.some(([s]) => s === v.status) ? v.status : "PENDING_REVIEW";
  const rows = (await asUser(getDb(), gate.identity.claims, (tx) => adminVenueQueue(tx, status))) as VenueQueueRow[];

  const active = detail.active_policy as Policy | null;
  const draft = detail.draft_policy as Policy | null;
  const proposed = draft ?? (v.status === "PENDING_REVIEW" ? active : null);
  const cover = detail.media.find((m) => m.status === "APPROVED") ?? detail.media[0];
  const seats = detail.resources.reduce((sum, r) => sum + r.capacity, 0);
  const prices = detail.resources.map((r) => r.hourly_paise).filter((p): p is number => p !== null);
  const pendingMedia = detail.media.filter((m) => m.status === "PENDING").length;
  const lastSubmitted = detail.draft_policy?.submitted_at ?? v.submitted_at;

  return (
    <main>
      <AdminNav roles={gate.me.platform_roles} active="/admin/venues" />
      <div className="page-heading">
        <div className="stacked-copy">
          <h1 className="title-sans">Good places start with careful review.</h1>
          <p className="lede">
            <a href="/admin/venues">Partner approval queue</a> · {rows.length} {rows.length === 1 ? "submission" : "submissions"} · Listing changes remain unpublished until approved.
          </p>
        </div>
        <a className="button secondary" href="/help">
          <BookOpen size={18} aria-hidden="true" />
          Review guidelines
        </a>
      </div>

      <div className="review-layout">
        <SubmissionList rows={rows} status={status} q={query.q ?? ""} selectedId={v.id} />

        <div className="review-detail">
          <section className="card review-header" aria-labelledby="venue-heading">
            <VenuePhoto mediaId={cover?.id ?? null} alt={cover?.alt_text ?? ""} className="review-cover" width={176} height={132} placeholderText={cover ? "Photo unavailable" : "No photos yet"} />
            <div className="review-summary">
              <p data-testid="admin-venue-status">
                <span className={`status-pill${STATUS_TONE[v.status] ?? " neutral"}`}>{VENUE_STATUS_LABEL[v.status] ?? v.status}</span>
                {v.status_reason ? <span className="muted small"> · {v.status_reason}</span> : null}
              </p>
              <h2 id="venue-heading" className="side-title">
                {v.name}
              </h2>
              <p className="muted small">
                {tagLabel(v.category_code)} · Version {v.version}
                {v.is_synthetic ? <span className="badge">Synthetic</span> : null}
              </p>
              <p className="small">
                {v.address}, {v.locality}
              </p>
              <p className="muted small">
                {active ? "A published version exists" : "Not yet published"}
                {lastSubmitted ? ` · Update submitted ${formatVenueDateTime(lastSubmitted)} IST` : ""}
              </p>
            </div>
          </section>

          {detail.publication_gaps.length > 0 ? (
            <div className="notice warm" role="status">
              <CircleAlert size={18} aria-hidden="true" />
              <div>
                <strong>Not ready to publish</strong>
                <p>Missing: {detail.publication_gaps.map((g) => GAP_LABEL[g] ?? g).join("; ")}</p>
              </div>
            </div>
          ) : null}

          <section className="card" aria-labelledby="ev-heading">
            <div className="section-heading stacked">
              <h2 id="ev-heading">Evidence &amp; verification</h2>
              <p className="small">Review only what the supplied evidence supports.</p>
            </div>
            <div className="evidence-columns">
              <div>
                <h3 className="panel-title">Business &amp; ownership</h3>
                <ul className="check-list">
                  <Check ok={Boolean(detail.partner)} label="Business record" detail={detail.partner ? `${detail.partner.legal_name} · ${detail.partner.status.toLowerCase()}` : "no partner business"} />
                  <Check ok={detail.owners.length > 0} label="Owners" detail={detail.owners.join(", ") || "no owner accounts"} />
                  <Check ok={Boolean(v.description)} label="Description" detail={v.description || "no description"} />
                </ul>
              </div>
              <div>
                <h3 className="panel-title">Space &amp; accessibility</h3>
                <ul className="check-list">
                  <Check ok={Boolean(v.address)} label="Location" detail={`${v.lat}, ${v.lng}`} />
                  <Check
                    ok={detail.amenities.length > 0}
                    label="Amenities"
                    detail={detail.amenities.map((a) => `${tagLabel(a.code)}${a.details ? ` (${a.details})` : ""}`).join(", ") || "none listed"}
                  />
                  <Check ok={detail.tags.length > 0} label="Good for" detail={detail.tags.map((t) => tagLabel(t.code)).join(", ") || "none listed"} />
                </ul>
              </div>
            </div>
            <hr />
            <dl className="detail-rows">
              <div>
                <dt>Table inventory</dt>
                <dd>
                  {detail.resources.length} {detail.resources.length === 1 ? "table" : "tables"} · {seats} seats
                </dd>
              </div>
              <div>
                <dt>Hourly rates</dt>
                <dd>
                  {prices.length === 0
                    ? "No price set"
                    : Math.min(...prices) === Math.max(...prices)
                      ? `${formatInrPaise(prices[0]!)}/h`
                      : `${formatInrPaise(Math.min(...prices))}-${formatInrPaise(Math.max(...prices))}/h`}
                </dd>
              </div>
              <div>
                <dt>Hours (IST)</dt>
                <dd>{hoursSummary(detail.hours)}</dd>
              </div>
            </dl>
            <details className="table-details">
              <summary className="section-link">All tables</summary>
              <ul className="plain-list">
                {detail.resources.map((r) => (
                  <li key={r.label}>
                    {r.label}: {r.capacity} seats · {r.hourly_paise ? `${formatInrPaise(r.hourly_paise)}/h` : "no price"} · {r.status.toLowerCase()}
                  </li>
                ))}
              </ul>
            </details>
          </section>

          <section className="card" aria-labelledby="change-heading">
            <div className="section-heading stacked">
              <h2 id="change-heading">What changed in this submission</h2>
              <p className="small">
                {draft ? "A rule change is waiting. It applies to new bookings only once approved." : v.status === "PENDING_REVIEW" ? "New listing. Nothing is public until approved." : "No rule change is waiting."}
                {pendingMedia > 0 ? ` ${pendingMedia} ${pendingMedia === 1 ? "photo is" : "photos are"} waiting below.` : ""}
              </p>
            </div>
            <div className="panel-row">
              <div className="compare-panel">
                <h3 className="panel-title">Currently published</h3>
                {active && v.status !== "PENDING_REVIEW" ? (
                  <dl>
                    {ruleLines(active).map(([k, val]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{val}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="muted small">Nothing published yet.</p>
                )}
              </div>
              <div className="compare-panel proposed">
                <h3 className="panel-title">Proposed {draft ? "update" : "listing"}</h3>
                {proposed ? (
                  <dl>
                    {ruleLines(proposed).map(([k, val]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{val}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="muted small">No changes proposed.</p>
                )}
              </div>
            </div>
            <div className="notice info">
              <Info size={18} aria-hidden="true" />
              <div>
                <strong>Keep public claims precise</strong>
                <p>Approve only what the evidence supports. Food, delivery and refund wording is shown to guests as written.</p>
              </div>
            </div>
          </section>

          <ReviewPanel detail={detail} />

          <section className="card" aria-labelledby="hist-heading">
            <h2 id="hist-heading">Audit trail</h2>
            {detail.history.length === 0 ? (
              <p className="muted">No recorded actions yet.</p>
            ) : (
              <ol className="timeline">
                {detail.history.map((h, i) => (
                  <li key={i} className="done">
                    <span className="marker">
                      <CheckIcon size={14} aria-hidden="true" />
                    </span>
                    <div>
                      <strong>
                        {formatVenueDateTime(h.at)} · {actionLabel(h.action)}
                      </strong>
                      <span>
                        {h.actor_role.toLowerCase().replace("_", " ")}
                        {h.reason ? ` · ${h.reason}` : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
