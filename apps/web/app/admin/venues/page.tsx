import { BookOpen, MousePointerClick } from "lucide-react";
import { asUser, adminVenueQueue, getDb } from "@simply-sit/db";
import { gatePortal, PortalBlocked } from "../../../lib/portal-page";
import { AdminNav } from "../../../lib/admin-nav";
import { queueStatus, SubmissionList, type VenueQueueRow } from "./submission-list";

export const dynamic = "force-dynamic";

// A02 queue - support/superadmin with TOTP. Live venues with a submitted rule change or new photos are flagged.
// Layout follows Figma "Admin · Partner review": the queue on the left, the chosen submission on the right.
export default async function AdminVenuesPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const gate = await gatePortal("/admin/venues", (me) => me.platform_roles.some((r) => r === "SUPERADMIN" || r === "SUPPORT"));
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const params = await searchParams;
  const status = queueStatus(params.status);
  const rows = (await asUser(getDb(), gate.identity.claims, (tx) => adminVenueQueue(tx, status))) as VenueQueueRow[];

  return (
    <main>
      <AdminNav roles={gate.me.platform_roles} active="/admin/venues" />
      <div className="page-heading">
        <div className="stacked-copy">
          <h1 className="title-sans">Good places start with careful review.</h1>
          <p className="lede">Partner approval queue · {rows.length} {rows.length === 1 ? "submission" : "submissions"} · Listing changes remain unpublished until approved.</p>
        </div>
        <a className="button secondary" href="/help">
          <BookOpen size={18} aria-hidden="true" />
          Review guidelines
        </a>
      </div>
      <div className="review-layout">
        <SubmissionList rows={rows} status={status} q={params.q ?? ""} />
        <section className="card empty-detail" aria-label="Submission detail">
          <MousePointerClick size={28} aria-hidden="true" />
          <h2>Choose a submission</h2>
          <p className="muted">Open a venue on the left to see its evidence, what changed and the decision options.</p>
        </section>
      </div>
    </main>
  );
}
