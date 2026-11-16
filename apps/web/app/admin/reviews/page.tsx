import { Info } from "lucide-react";
import { adminReviewQueue, asUser, getDb } from "@simply-sit/db";
import { formatVenueDateTime } from "../../../lib/format";
import { gatePortal, PortalBlocked } from "../../../lib/portal-page";
import { TableScroll } from "../../../lib/table-scroll";
import { AdminNav } from "../../../lib/admin-nav";
import { ModerateButtons } from "./moderate-buttons";

export const dynamic = "force-dynamic";

type Row = { review_id: string; venue_name: string; rating: number; body: string | null; created_at: string; version: number; moderation_reason: string | null };
const STATUSES = [["PENDING", "To check"], ["PUBLISHED", "Published"], ["HIDDEN", "Hidden"]] as const;
const STATE_TEXT: Record<string, string> = { PENDING: "Awaiting review", PUBLISHED: "Published", HIDDEN: "Hidden" };
const stars = (n: number) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));

// Review moderation (A04) - Figma "D · Admin desktop · Review moderation". Support/superadmin with TOTP. Hiding needs a
// reason; every decision is audited and the original text is kept.
export default async function AdminReviewsPage({ searchParams }: { searchParams: Promise<{ status?: string; review?: string }> }) {
  const gate = await gatePortal("/admin/reviews", (me) => me.platform_roles.some((r) => r === "SUPERADMIN" || r === "SUPPORT"));
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const sp = await searchParams;
  const status = STATUSES.some(([s]) => s === sp.status) ? sp.status! : "PENDING";
  const rows = (await asUser(getDb(), gate.identity.claims, (tx) => adminReviewQueue(tx, status))) as Row[];
  const selected = rows.find((r) => r.review_id === sp.review) ?? null;
  const shortId = (id: string) => `RV-${id.slice(0, 6).toUpperCase()}`;

  return (
    <main>
      <AdminNav roles={gate.me.platform_roles} active="/admin/reviews" />
      <h1>Fair feedback. Carefully moderated.</h1>
      <p className="lede page-lede">Completed-stay reviews · Private review workspace</p>
      <nav aria-label="Review status" className="page-lede">
        <ul className="choice-pills">
          {STATUSES.map(([s, label]) => (
            <li key={s}>
              <a className={`choice-pill${s === status ? " selected" : ""}`} href={`/admin/reviews?status=${s}`} aria-current={s === status ? "page" : undefined}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <section className="card book-card page-lede" aria-labelledby="queue-heading">
        <h2 id="queue-heading">{STATUSES.find(([s]) => s === status)![1]} · completed-stay reviews</h2>
        {rows.length === 0 ? (
          <p className="book-note">Nothing here.</p>
        ) : (
          <TableScroll label="Review queue">
            <table data-testid="review-queue">
              <thead>
                <tr>
                  <th scope="col">Review</th>
                  <th scope="col">Venue / stay</th>
                  <th scope="col">Rating</th>
                  <th scope="col">State</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.review_id} className={r.review_id === selected?.review_id ? "row-highlight" : undefined}>
                    <th scope="row">{shortId(r.review_id)}</th>
                    <td>
                      {r.venue_name} / {formatVenueDateTime(r.created_at)}
                    </td>
                    <td>{r.rating} of 5</td>
                    <td>{STATE_TEXT[status]}</td>
                    <td>
                      <a href={`/admin/reviews?status=${status}&review=${r.review_id}`} data-testid={`open-review-${r.review_id}`}
                        aria-current={r.review_id === selected?.review_id ? "true" : undefined}>
                        Open{r.review_id === selected?.review_id ? " →" : ""}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </section>

      {selected ? (
        <div className="partner-layout">
          <div className="book-main">
            <section className="card book-card" aria-labelledby="selected-heading">
              <h2 id="selected-heading">Selected review · {shortId(selected.review_id)}</h2>
              <span className="status-pill">
                <img src="/design/status-dot-available.svg" alt="" width={5} height={5} />
                Completed stay verified
              </span>
              <p className="book-when">
                {selected.venue_name} · submitted {formatVenueDateTime(selected.created_at)} IST
              </p>
              <p className="review-stars" aria-label={`${selected.rating} of 5`}>
                {stars(selected.rating)}
              </p>
              <p className="book-when">{selected.body ? `“${selected.body}”` : "No text — rating only."}</p>
              {selected.moderation_reason ? <p className="book-note">Last decision reason: {selected.moderation_reason}</p> : null}
            </section>
            <div className="notice info">
              <Info size={20} aria-hidden="true" />
              <div>
                <strong>Moderate the content, not the rating</strong>
                <p>Do not rewrite guest claims or suppress criticism for being negative. Apply the review policy consistently.</p>
              </div>
            </div>
          </div>
          <div className="book-side">
            <ModerateButtons reviewId={selected.review_id} version={selected.version} status={status} />
          </div>
        </div>
      ) : rows.length > 0 ? (
        <p className="book-note page-lede">Open a review to see its text and record a decision.</p>
      ) : null}

      <div className="workspace-footer">
        <p>SIMPLY SIT · Admin console</p>
        <p>Asia/Kolkata</p>
      </div>
    </main>
  );
}
