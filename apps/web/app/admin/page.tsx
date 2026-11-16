import { CalendarDays, Info, MapPin } from "lucide-react";
import { percentOf, type BusinessMetrics } from "@simply-sit/contracts";
import { adminBusinessMetrics, adminTicketQueue, adminVenueQueue, asUser, getDb, queueMetrics } from "@simply-sit/db";
import { formatInrPaise, venueLocalDate } from "../../lib/format";
import { PortalBlocked, gatePortal } from "../../lib/portal-page";
import { TableScroll } from "../../lib/table-scroll";
import { AdminNav } from "../../lib/admin-nav";

export const dynamic = "force-dynamic";

type Metrics = {
  ready: number;
  leased: number;
  dead: number;
  oldest_ready_age_seconds: number;
  due_holds: number;
  workers: { worker_id: string; last_seen_at: string; ticks: number; jobs_completed: number; jobs_failed: number; holds_expired: number }[];
};
type VenueRow = { venue_id: string; name: string; locality: string; status: string; submitted_at: string | null; pending_policy: boolean; pending_media: number };
type TicketRow = { ticket_id: string; public_ref: string; priority: "NORMAL" | "HIGH" | "URGENT"; created_at: string; venue_name: string | null; reporter_role: string; assigned_to_me: boolean };
type QueueItem = { key: string; kind: "review" | "support"; item: string; context: string; state: string; tone: string; since: string | null; owner: string; action: string; href: string };

const DAY_MS = 86_400_000;

function age(since: string | null, now: number) {
  if (!since) return "—";
  const minutes = Math.max(0, Math.round((now - Date.parse(since)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${Math.floor(minutes / 1440)} days`;
}

// A01 - platform admin overview (Figma "Admin · Marketplace overview"). Superadmin/support/finance with MFA. Figures
// come from the same database functions as Metrics, Partner review and Support; finance figures only for finance roles.
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ queue?: string }> }) {
  const gate = await gatePortal("/admin", (me) => me.platform_roles.length > 0);
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const roles = gate.me.platform_roles;
  const operations = roles.some((r) => r === "SUPERADMIN" || r === "SUPPORT");
  const finance = roles.some((r) => r === "SUPERADMIN" || r === "FINANCE");
  const requestedQueue = (await searchParams).queue;
  const queueFilter = requestedQueue === "review" || requestedQueue === "support" ? requestedQueue : "all";
  const now = Date.now();
  const today = venueLocalDate(330, now);
  const days = Array.from({ length: 7 }, (_, i) => venueLocalDate(330, now - (6 - i) * DAY_MS));

  const data = await asUser(getDb(), gate.identity.claims, async (tx) => {
    const todayMetrics = (await adminBusinessMetrics(tx, { from: today, to: today })) as BusinessMetrics;
    const week: { date: string; created: number }[] = [];
    for (const date of days) {
      const day = date === today ? todayMetrics : ((await adminBusinessMetrics(tx, { from: date, to: date })) as BusinessMetrics);
      week.push({ date, created: day.funnel.holds });
    }
    const metrics = operations ? ((await queueMetrics(tx)) as Metrics) : null;
    const reviews = operations ? ((await adminVenueQueue(tx, "PENDING_REVIEW")) as VenueRow[]) : [];
    const tickets = operations ? ((await adminTicketQueue(tx, "OPEN")) as { tickets: TicketRow[]; restricted_count: number }) : null;
    return { todayMetrics, week, metrics, reviews, tickets };
  });
  const { todayMetrics: m, week, metrics, reviews, tickets } = data;

  const cancelled = m.outcomes.customer_cancelled + m.outcomes.service_cancelled;
  const occupancy = percentOf(m.occupancy.booked_minutes, m.occupancy.open_minutes);
  const refundsInProgress = Math.max(0, m.reliability.refunds_requested - m.reliability.refunds_processed - m.reliability.refunds_failed_or_unknown);
  const openTickets = tickets?.tickets ?? [];
  const urgent = openTickets.filter((t) => t.priority === "URGENT").length;
  const oldestUnassigned = openTickets.filter((t) => !t.assigned_to_me).map((t) => t.created_at).sort()[0] ?? null;
  const weekTotal = week.reduce((sum, d) => sum + d.created, 0);
  const weekMax = Math.max(1, ...week.map((d) => d.created));
  const dayLabel = (date: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`));
  const longToday = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
  const clock = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);

  const queue: QueueItem[] = [
    ...reviews.map((r) => ({
      key: `v-${r.venue_id}`,
      kind: "review" as const,
      item: `Listing review · ${r.name}`,
      context: `${r.locality}${r.pending_policy ? " · Rule change" : ""}${r.pending_media ? ` · ${r.pending_media} photos` : ""}`,
      state: "Ready for review",
      tone: " sage",
      since: r.submitted_at,
      owner: "Partner review",
      action: "Review evidence →",
      href: `/admin/venues/${r.venue_id}`
    })),
    ...openTickets.map((t) => ({
      key: `t-${t.ticket_id}`,
      kind: "support" as const,
      item: `Support · ${t.public_ref}`,
      context: t.reporter_role === "VENUE_STAFF" ? `Venue staff · ${t.venue_name ?? ""}` : "Customer",
      state: t.priority === "URGENT" ? "Urgent" : t.priority === "HIGH" ? "High priority" : "Open",
      tone: t.priority === "URGENT" ? " danger" : t.priority === "HIGH" ? " warm" : " neutral",
      since: t.created_at,
      owner: t.assigned_to_me ? "You" : "Unassigned",
      action: t.assigned_to_me ? "Respond →" : "Assign & respond →",
      href: `/admin/support/${t.ticket_id}`
    }))
  ].sort((a, b) => (a.since ?? "").localeCompare(b.since ?? ""));
  const shownQueue = queue.filter((q) => queueFilter === "all" || q.kind === queueFilter);

  return (
    <main>
      <AdminNav roles={gate.me.platform_roles} active="/admin" />
      <h1>The marketplace, at a glance.</h1>
      <div className="page-heading">
        <p className="lede">
          {longToday} · Bengaluru sample region · Live operations snapshot at {clock} IST.
        </p>
        <div className="heading-actions">
          <span className="button secondary static">
            <MapPin size={18} aria-hidden="true" />
            Bengaluru
          </span>
          <a className="button" href={`/admin/metrics?from=${today}&to=${today}`}>
            <CalendarDays size={18} aria-hidden="true" />
            Today · {dayLabel(today)}
          </a>
        </div>
      </div>

      <section className="metric-row" aria-label="Today across the marketplace">
        <div className="metric">
          <p className="metric-label">Today’s bookings</p>
          <p className="metric-value">{m.funnel.holds}</p>
          <p className="metric-note">
            {m.outcomes.paid_bookings} paid / confirmed · {cancelled} cancelled
          </p>
        </div>
        <div className="metric">
          <p className="metric-label">Table GBV</p>
          <p className="metric-value">{m.finance ? formatInrPaise(m.finance.collected_paise) : "—"}</p>
          <p className="metric-note">{m.finance ? `${m.outcomes.paid_bookings} paid bookings · sandbox fees & GST are ₹0` : "Finance roles only"}</p>
        </div>
        <div className="metric">
          <p className="metric-label">Platform revenue</p>
          <p className="metric-value">{m.finance ? formatInrPaise(m.finance.platform_fee_paise) : "—"}</p>
          <p className="metric-note">{m.finance ? "Platform fees · not partner commission" : "Finance roles only"}</p>
        </div>
        <div className="metric">
          <p className="metric-label">Paid occupancy</p>
          <p className="metric-value">{occupancy === null ? "—" : `${occupancy}%`}</p>
          <p className="metric-note">
            {Math.round(m.occupancy.booked_minutes / 60)} paid hours / {Math.round(m.occupancy.open_minutes / 60)} sellable hours
          </p>
        </div>
      </section>

      <section className="panel-row compact-panels" aria-label="Operational signals">
        <div className="mini-panel">
          <p className="detail-line">
            <span>Cancellations</span>
            <strong>
              {cancelled} · {percentOf(cancelled, m.funnel.holds) ?? 0}%
            </strong>
          </p>
          <p className="metric-note">
            {cancelled} of {m.funnel.holds} created bookings today
          </p>
        </div>
        <div className="mini-panel">
          <p className="detail-line">
            <span>Refunds in progress</span>
            <strong>
              {refundsInProgress} {refundsInProgress === 1 ? "case" : "cases"}
            </strong>
          </p>
          <p className="metric-note">
            {m.finance ? `${formatInrPaise(m.finance.refunded_paise)} refunded today` : `${m.reliability.refunds_failed_or_unknown} failed or unknown today`}
          </p>
        </div>
        <div className="mini-panel">
          <p className="detail-line">
            <span>Support backlog</span>
            <strong>{tickets ? `${openTickets.length} open · ${urgent} urgent` : "—"}</strong>
          </p>
          <p className="metric-note">{tickets ? `Oldest unassigned · ${age(oldestUnassigned, now)}` : "Support roles only"}</p>
        </div>
      </section>

      <div className="ops-columns wide-side">
        <section className="card" aria-labelledby="trend-heading">
          <div className="section-heading">
            <div className="stacked-copy">
              <h2 id="trend-heading">A week of good hours</h2>
              <p>
                Created bookings · {dayLabel(days[0]!)}–{dayLabel(today)}
              </p>
            </div>
            <a className="section-link" href={`/admin/metrics?from=${days[0]}&to=${today}`}>
              Last 7 days
            </a>
          </div>
          <p className="trend-summary">
            <strong>{weekTotal}</strong>
            <span>bookings this week · Today is in progress</span>
          </p>
          <ol className="bar-chart" aria-label="Created bookings per day">
            {week.map((d) => (
              <li key={d.date}>
                <span className="bar-value">{d.created}</span>
                <span
                  className={d.date === today ? "bar today" : "bar"}
                  style={{ height: `${Math.max(4, Math.round((d.created / weekMax) * 124))}px` }}
                  aria-hidden="true"
                />
                <span className="bar-label">{dayLabel(d.date)}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="card" aria-labelledby="health-heading">
          <h2 id="health-heading">Keep the day moving</h2>
          <dl className="detail-rows">
            {operations ? (
              <div>
                <dt>Partner reviews</dt>
                <dd>{reviews.length} pending</dd>
              </div>
            ) : null}
            <div>
              <dt>Refunds failed or unknown</dt>
              <dd>{m.reliability.refunds_failed_or_unknown} today</dd>
            </div>
            <div>
              <dt>Reconciliation</dt>
              <dd>
                {m.finance
                  ? m.finance.reconciliation === "MATCHED"
                    ? "Matched"
                    : m.finance.reconciliation === "NONE"
                      ? "No run today"
                      : "Needs review"
                  : "Finance roles"}
              </dd>
            </div>
          </dl>
          <hr />
          <span className="status-pill">
            <img src="/design/status-dot-available.svg" alt="" width={5} height={5} />
            Overlapping reservations blocked by the database
          </span>
          <p className="fine-print">Availability checks include holds, closures and cleaning; a database constraint rejects any overlap.</p>
          {tickets && urgent > 0 ? (
            <div className="notice warm">
              <Info size={19} aria-hidden="true" />
              <div>
                <strong>
                  {urgent} support {urgent === 1 ? "case needs" : "cases need"} a first response
                </strong>
                <p>Prioritise guests arriving within 30 minutes.</p>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {operations ? (
        <section className="card flush" aria-labelledby="queue-heading">
          <div className="card-section">
            <div className="section-heading">
              <h2 id="queue-heading">Your operational queue</h2>
              <a className="section-link" href="/admin/support">
                Open all queues →
              </a>
            </div>
            <nav className="chips" aria-label="Queue">
              <a className="chip" href="/admin" aria-current={queueFilter === "all" ? "true" : undefined}>
                Priority items · {queue.length}
              </a>
              <a className="chip" href="/admin?queue=review" aria-current={queueFilter === "review" ? "true" : undefined}>
                Partner review · {reviews.length}
              </a>
              <a className="chip" href="/admin?queue=support" aria-current={queueFilter === "support" ? "true" : undefined}>
                Support · {openTickets.length}
              </a>
            </nav>
          </div>
          {shownQueue.length === 0 ? (
            <p className="empty-row">Nothing waiting in this queue.</p>
          ) : (
            <TableScroll label="Operational queue">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Item / reference</th>
                    <th scope="col">Context</th>
                    <th scope="col">State</th>
                    <th scope="col">Age</th>
                    <th scope="col">Owner</th>
                    <th scope="col">Next action</th>
                  </tr>
                </thead>
                <tbody>
                  {shownQueue.map((q) => (
                    <tr key={q.key}>
                      <td className="cell-strong small">{q.item}</td>
                      <td>{q.context}</td>
                      <td>
                        <span className={`status-pill${q.tone}`}>{q.state}</span>
                      </td>
                      <td>{age(q.since, now)}</td>
                      <td>{q.owner}</td>
                      <td>
                        <a className="row-action" href={q.href}>
                          {q.action}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
          {tickets && tickets.restricted_count > 0 ? (
            <p className="table-footer">{tickets.restricted_count} confidential tickets are counted but not shown.</p>
          ) : null}
        </section>
      ) : null}

      {metrics ? (
        <section className="card" aria-labelledby="q-heading" data-testid="queue-metrics">
          <h2 id="q-heading">Background work</h2>
          <dl className="detail-rows">
            <div>
              <dt>Ready jobs</dt>
              <dd>{metrics.ready}</dd>
            </div>
            <div>
              <dt>Leased jobs</dt>
              <dd>{metrics.leased}</dd>
            </div>
            <div>
              <dt>Dead-lettered</dt>
              <dd className={metrics.dead > 0 ? "status-error" : undefined}>{metrics.dead}</dd>
            </div>
            <div>
              <dt>Oldest ready job</dt>
              <dd>{metrics.oldest_ready_age_seconds} s</dd>
            </div>
            <div>
              <dt>Holds past their deadline awaiting expiry</dt>
              <dd>{metrics.due_holds}</dd>
            </div>
          </dl>
          <h3>Workers</h3>
          {metrics.workers.length === 0 ? (
            <p className="muted">No worker heartbeat recorded yet.</p>
          ) : (
            <ul className="plain-list">
              {metrics.workers.map((w) => (
                <li key={w.worker_id}>
                  {w.worker_id}: last seen {w.last_seen_at}, {w.jobs_completed} done, {w.jobs_failed} failed, {w.holds_expired} holds expired
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <p className="fine-print">
        Revenue shown here is platform fees, not partner commission. Net venue settlements are reconciled separately in{" "}
        {finance ? <a href="/admin/finance">Finance</a> : "Finance"}.
      </p>
      <div className="workspace-footer">
        <p>SIMPLY SIT · Admin console</p>
        <p>
          Last synced {clock} IST · {dayLabel(today)}
        </p>
      </div>
    </main>
  );
}
