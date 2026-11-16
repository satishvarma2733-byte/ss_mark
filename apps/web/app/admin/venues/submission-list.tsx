// Left column of Figma "Admin · Partner review": search, status chips and submission cards. Server component;
// search filters the loaded queue by name or area (GET), status chips load another queue.
import { Search } from "lucide-react";
import { formatVenueDateTime } from "../../../lib/format";
import { FilterChip } from "../../../components/ui";

export type VenueQueueRow = {
  venue_id: string;
  name: string;
  locality: string;
  status: string;
  submitted_at: string | null;
  is_synthetic: boolean;
  pending_policy: boolean;
  pending_media: number;
};

export const QUEUE_STATUSES = [
  ["PENDING_REVIEW", "Waiting for review"],
  ["PUBLISHED", "Live"],
  ["PAUSED", "Paused"],
  ["DRAFT", "Drafts"],
  ["REJECTED", "Rejected"]
] as const;

export function queueStatus(requested: string | undefined) {
  return QUEUE_STATUSES.some(([s]) => s === requested) ? requested! : "PENDING_REVIEW";
}

function needs(row: VenueQueueRow) {
  return [
    row.status === "PENDING_REVIEW" ? "Listing review" : null,
    row.pending_policy ? "Rule change" : null,
    row.pending_media > 0 ? `${row.pending_media} ${row.pending_media === 1 ? "photo" : "photos"}` : null
  ].filter(Boolean) as string[];
}

function statePill(row: VenueQueueRow): { text: string; tone: string } {
  if (row.status === "PENDING_REVIEW" || row.pending_policy || row.pending_media > 0) return { text: "Ready for review", tone: " sage" };
  if (row.status === "PUBLISHED") return { text: "Live", tone: "" };
  if (row.status === "PAUSED") return { text: "Paused", tone: " warm" };
  if (row.status === "REJECTED") return { text: "Rejected", tone: " danger" };
  return { text: "Draft", tone: " neutral" };
}

export function SubmissionList({ rows, status, q, selectedId }: { rows: VenueQueueRow[]; status: string; q: string; selectedId?: string }) {
  const term = q.trim().toLowerCase();
  const shown = term ? rows.filter((r) => r.name.toLowerCase().includes(term) || r.locality.toLowerCase().includes(term)) : rows;
  return (
    <aside className="submission-column" aria-label="Submissions">
      <form className="field" method="get" action="/admin/venues" role="search">
        <input type="hidden" name="status" value={status} />
        <label className="field-label" htmlFor="submission-search">
          Find a submission
        </label>
        <div className="field-control compact">
          <Search size={17} aria-hidden="true" />
          <input id="submission-search" name="q" defaultValue={q} placeholder="Venue or area" maxLength={60} />
        </div>
      </form>
      <nav aria-label="Status" className="chips">
        {QUEUE_STATUSES.map(([s, label]) => (
          <FilterChip key={s} href={`/admin/venues?status=${s}`} aria-current={s === status ? "page" : undefined}>
            {label}
            {s === status ? ` · ${rows.length}` : ""}
          </FilterChip>
        ))}
      </nav>
      {shown.length === 0 ? (
        <p className="notice">{rows.length === 0 ? "Nothing here." : "No submissions match that search."}</p>
      ) : (
        <ul className="submission-list" data-testid="venue-queue">
          {shown.map((r) => {
            const pill = statePill(r);
            return (
              <li key={r.venue_id}>
                <article className={r.venue_id === selectedId ? "submission-card selected" : "submission-card"}>
                  <h2>
                    <a href={`/admin/venues/${r.venue_id}`} aria-current={r.venue_id === selectedId ? "page" : undefined}>
                      {r.name}
                    </a>
                  </h2>
                  <p className="muted small">
                    {[...needs(r), r.locality].join(" · ")}
                    {r.is_synthetic ? " · Synthetic" : ""}
                  </p>
                  <span className={`status-pill${pill.tone}`}>{pill.text}</span>
                  <p className="muted small">{r.submitted_at ? `Submitted ${formatVenueDateTime(r.submitted_at)} IST` : "Not submitted"}</p>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
