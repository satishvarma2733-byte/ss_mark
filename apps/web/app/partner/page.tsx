import { redirect } from "next/navigation";
import { CalendarDays, Check, Clock3, Info, ScanLine, Search } from "lucide-react";
import { asUser, getDb, myInvitations, partnerCalendar, partnerVenueOverview } from "@simply-sit/db";
import { resolveIdentity } from "../../lib/auth/identity";
import { formatVenueTime } from "../../lib/format";
import { loadMe } from "../../lib/me";
import { PartnerNav } from "../../lib/partner-page";
import { GAP_LABEL, VENUE_STATUS_LABEL, type CalendarData, type VenueOverview } from "../../lib/partner-types";
import { PortalBlocked } from "../../lib/portal-page";
import { Invitations, type Invitation, type InvitationLink } from "./invitations";
import { TableScroll } from "../../lib/table-scroll";
import { ButtonLink, Card, FilterChip, StatusPill } from "../../components/ui";

export const dynamic = "force-dynamic";

const IST_DAY_MS = 86_400_000;
function istDayRange(now = Date.now()) {
  const istMidnight = Math.floor((now + 330 * 60_000) / IST_DAY_MS) * IST_DAY_MS - 330 * 60_000;
  return { from: new Date(istMidnight).toISOString(), to: new Date(istMidnight + IST_DAY_MS).toISOString() };
}

const FILTERS = [
  { key: "all", label: "All", match: () => true },
  { key: "arrivals", label: "Arrivals", match: (s: string) => s === "CONFIRMED" },
  { key: "checked_in", label: "Checked in", match: (s: string) => s === "CHECKED_IN" },
  { key: "held", label: "Held", match: (s: string) => s === "HOLD" || s === "PENDING_PAYMENT" },
  { key: "completed", label: "Completed", match: (s: string) => s === "COMPLETED" },
  { key: "cancelled", label: "Cancelled", match: (s: string) => s === "CANCELLED" }
] as const;

function statusPill(status: string): { text: string; tone: "" | " warning" | " neutral" } {
  if (status === "CONFIRMED") return { text: "Confirmed", tone: "" };
  if (status === "CHECKED_IN") return { text: "Checked in", tone: "" };
  if (status === "HOLD" || status === "PENDING_PAYMENT") return { text: "Held (unpaid)", tone: " warning" };
  if (status === "COMPLETED") return { text: "Completed", tone: " neutral" };
  if (status === "CANCELLED") return { text: "Cancelled", tone: " neutral" };
  const text = status.replace(/_/g, " ").toLowerCase();
  return { text: text.charAt(0).toUpperCase() + text.slice(1), tone: " neutral" };
}

function greeting(now = Date.now()) {
  const hour = new Date(now + 330 * 60_000).getUTCHours();
  return hour < 12 ? "Good morning." : hour < 17 ? "Good afternoon." : "Good evening.";
}

// P02 - partner home: invitations to accept, "list your venue", and for each assigned venue today's bookings, table
// readiness and (managers) the listing status with what is still missing. Every action is re-checked by the database.
// Layout follows Figma "Partner · Today and booking operations".
export default async function PartnerHomePage({ searchParams }: {
  searchParams: Promise<{ venue?: string; invitation?: string; token?: string; filter?: string; q?: string }>;
}) {
  const params = await searchParams;
  // An invitation email link (?invitation=&token=) survives the sign-in redirect so it can be accepted afterwards.
  const link: InvitationLink | null = params.invitation && params.token ? { invitationId: params.invitation, token: params.token } : null;
  const identity = await resolveIdentity();
  if (identity.kind !== "user") {
    const back = link ? `/partner?${new URLSearchParams({ invitation: link.invitationId, token: link.token }).toString()}` : "/partner";
    redirect(`/sign-in?redirect_path=${encodeURIComponent(back)}`);
  }
  const me = await loadMe(identity.claims);
  const invitations = (await asUser(getDb(), identity.claims, (tx) => myInvitations(tx))) as Invitation[];
  const memberships = me.venue_memberships;

  if (memberships.length === 0) {
    return (
      <main>
        <h1>Partner portal</h1>
        <Invitations invitations={invitations} link={link} />
        <Card style={{ marginTop: 16 }} aria-labelledby="apply-heading">
          <h2 id="apply-heading">List your venue on Simply Sit</h2>
          <p>Cafes, restaurants, lounges and other hospitality spaces can offer tables by the hour. We review every listing before customers see it.</p>
          <ButtonLink href="/partner/apply" data-testid="partner-apply-link">
            Start an application
          </ButtonLink>
        </Card>
      </main>
    );
  }
  if (identity.claims.aal !== "aal2") {
    return (
      <>
        {invitations.length > 0 ? <main><Invitations invitations={invitations} link={link} /></main> : null}
        <PortalBlocked gate={{ state: "mfa", path: "/partner" }} />
      </>
    );
  }

  const { venue } = params;
  const current = memberships.find((m) => m.venue_id === venue) ?? memberships[0]!;
  const isManager = current.role !== "STAFF";
  const { from, to } = istDayRange();
  const [calendar, overview] = await asUser(getDb(), identity.claims, async (tx) => [
    (await partnerCalendar(tx, current.venue_id, from, to)) as CalendarData,
    isManager ? ((await partnerVenueOverview(tx, current.venue_id)) as VenueOverview) : null
  ] as const);
  const label = (id: string) => calendar.resources.find((r) => r.id === id)?.label ?? "Table";
  const now = Date.now();
  const all = [...calendar.bookings].sort((a, b) => a.start_at.localeCompare(b.start_at));
  const count = (key: (typeof FILTERS)[number]["key"]) => all.filter((b) => FILTERS.find((f) => f.key === key)!.match(b.status)).length;
  const filter = FILTERS.find((f) => f.key === params.filter) ?? FILTERS[0];
  const q = (params.q ?? "").trim().toLowerCase().slice(0, 60);
  const shown = all.filter((b) => filter.match(b.status) && (!q || b.public_ref.toLowerCase().includes(q) || label(b.resource_id).toLowerCase().includes(q)));
  const confirmed = all.filter((b) => b.status === "CONFIRMED");
  const checkedIn = all.filter((b) => b.status === "CHECKED_IN");
  const soon = confirmed.filter((b) => Date.parse(b.start_at) - now <= 2 * 3_600_000);
  const leavingSoon = checkedIn.filter((b) => Date.parse(b.end_at) - now <= 3_600_000);
  const active = calendar.resources.filter((r) => r.status === "ACTIVE");
  const cleaning = active.filter((r) => r.operational_state === "CLEANING");
  const nextArrival = confirmed.find((b) => Date.parse(b.end_at) > now);
  const venueQuery = `venue=${current.venue_id}`;
  const filterHref = (key: string) => `/partner?${venueQuery}${key === "all" ? "" : `&filter=${key}`}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const todayLong = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
  const todayShort = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(now);
  const syncedAt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);

  return (
    <main>
      <h1>{greeting(now)}</h1>
      <PartnerNav current={current} memberships={memberships} active="/partner" />
      <div className="page-heading">
        <p className="lede">{todayLong} · A clear view of every arrival, table and handover.</p>
        <ButtonLink variant="secondary" href={`/partner/calendar?${venueQuery}`}>
          <CalendarDays size={18} aria-hidden="true" />
          {todayShort} · Today
        </ButtonLink>
      </div>
      <Invitations invitations={invitations} link={link} />

      <section className="metric-row" aria-label="Today at a glance">
        <div className="metric">
          <p className="metric-label">Today’s bookings</p>
          <p className="metric-value">{all.length}</p>
          <p className="metric-note">
            {confirmed.length} upcoming · {checkedIn.length} active · {count("completed")} done · {count("cancelled")} cancelled
          </p>
        </div>
        <div className="metric">
          <p className="metric-label">Expected arrivals</p>
          <p className="metric-value">{soon.length}</p>
          <p className="metric-note">
            Next 2 hours · {soon.reduce((sum, b) => sum + b.party_size, 0)} guests
          </p>
        </div>
        <div className="metric">
          <p className="metric-label">Checked in</p>
          <p className="metric-value">{checkedIn.length}</p>
          <p className="metric-note">{leavingSoon.length} departures in the next hour</p>
        </div>
        <div className="metric">
          <p className="metric-label">Tables to clean</p>
          <p className="metric-value">{cleaning.length}</p>
          <p className="metric-note">
            {active.length} tables · {active.filter((r) => r.operational_state === "READY").length} ready ·{" "}
            {calendar.resources.length - active.length + active.filter((r) => r.operational_state === "OUT_OF_SERVICE").length} blocked
          </p>
        </div>
      </section>

      <div className="ops-columns">
        <div className="ops-main">
          <Card className="listing-card" aria-labelledby="venue-heading" data-testid={overview ? "venue-status" : undefined}>
            <div className="section-heading">
              <h2 id="venue-heading">
                {current.venue_name} <span className="badge">{current.role}</span>
              </h2>
              {overview ? (
                <span className={overview.venue.status === "PUBLISHED" ? "status-pill" : "status-pill warning"}>
                  {VENUE_STATUS_LABEL[overview.venue.status] ?? overview.venue.status}
                </span>
              ) : null}
            </div>
            {overview?.venue.status_reason ? <p className="status-warning">Reason from Simply Sit: {overview.venue.status_reason}</p> : null}
            {overview && overview.venue.status === "DRAFT" && overview.publication_gaps.length > 0 ? (
              <>
                <p>Before you can send it for review, add:</p>
                <ul>
                  {overview.publication_gaps.map((g) => (
                    <li key={g}>{GAP_LABEL[g] ?? g}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {overview ? (
              <p className="link-row">
                <a href={`/partner/venue?${venueQuery}`}>Edit venue</a> · <a href={`/partner/inventory?${venueQuery}`}>Tables and hours</a>
              </p>
            ) : (
              <p className="muted small">Arrivals and table readiness for this venue.</p>
            )}
          </Card>

          <Card className="flush" aria-labelledby="today-heading">
            <div className="card-section">
              <div className="section-heading">
                <h2 id="today-heading">Today’s reservations</h2>
                <a className="section-link" href={`/partner/calendar?${venueQuery}`}>
                  Open calendar →
                </a>
              </div>
              <form className="field" method="get" action="/partner" role="search">
                <input type="hidden" name="venue" value={current.venue_id} />
                {filter.key !== "all" ? <input type="hidden" name="filter" value={filter.key} /> : null}
                <label className="field-label" htmlFor="booking-search">
                  Search bookings
                </label>
                <div className="field-control compact">
                  <Search size={17} aria-hidden="true" />
                  <input id="booking-search" name="q" defaultValue={params.q ?? ""} placeholder="Booking reference or table" maxLength={60} />
                </div>
              </form>
              <nav className="chips" aria-label="Booking status">
                {FILTERS.map((f) => (
                  <FilterChip key={f.key} href={filterHref(f.key)} aria-current={f.key === filter.key ? "true" : undefined}>
                    {f.label} · {count(f.key)}
                  </FilterChip>
                ))}
              </nav>
            </div>
            {shown.length === 0 ? (
              <p className="empty-row">{all.length === 0 ? "No bookings today." : "No bookings match this view."}</p>
            ) : (
              <TableScroll label="Today's bookings">
                <table data-testid="today-bookings">
                  <thead>
                    <tr>
                      <th scope="col">Booking</th>
                      <th scope="col">Table · Party</th>
                      <th scope="col">Time · IST</th>
                      <th scope="col">Status</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((b) => {
                      const pill = statusPill(b.status);
                      return (
                        <tr key={b.booking_id}>
                          <td className="cell-strong">{b.public_ref}</td>
                          <td>
                            {label(b.resource_id)} · {b.party_size} {b.party_size === 1 ? "guest" : "guests"}
                          </td>
                          <td>
                            {formatVenueTime(b.start_at)}–{formatVenueTime(b.end_at)}
                          </td>
                          <td>
                            <span className={`status-pill${pill.tone}`}>{pill.text}</span>
                          </td>
                          <td>
                            <a className="row-action" href={`/partner/bookings/${b.booking_id}`}>
                              {b.status === "CONFIRMED" ? "View arrival →" : b.status === "CHECKED_IN" ? "Open stay →" : "View booking →"}
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScroll>
            )}
            <p className="table-footer">
              Showing {shown.length} of {all.length} bookings
            </p>
          </Card>

          <Card aria-labelledby="cleaning-heading">
            <div className="section-heading stacked">
              <h2 id="cleaning-heading">Prepare the next good hour</h2>
              <p>Tables become available only after cleaning is marked complete.</p>
            </div>
            {cleaning.length === 0 ? (
              <p className="muted">No tables waiting for cleaning. {active.length} active tables are ready or in use.</p>
            ) : (
              <div className="panel-row">
                {cleaning.map((r) => (
                  <div key={r.id} className="soft-panel">
                    <StatusPill tone="warm">Cleaning · {r.label}</StatusPill>
                    <p>Mark it ready once the table is cleared and reset.</p>
                    <ButtonLink variant="secondary" block href={`/staff?${venueQuery}`}>
                      Mark clean &amp; ready
                    </ButtonLink>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <aside className="ops-side" aria-label="Next arrival">
          <Card>
            {nextArrival ? (
              <>
                <StatusPill>Confirmed · Payment verified</StatusPill>
                <p className="side-title">{nextArrival.public_ref}</p>
                <p className="muted small">Next arrival at {current.venue_name}</p>
                <dl className="detail-rows">
                  <div>
                    <dt>Table / guests</dt>
                    <dd>
                      {label(nextArrival.resource_id)} / {nextArrival.party_size}
                    </dd>
                  </div>
                  <div>
                    <dt>Today · IST</dt>
                    <dd>
                      {formatVenueTime(nextArrival.start_at)}–{formatVenueTime(nextArrival.end_at)}
                    </dd>
                  </div>
                </dl>
              </>
            ) : (
              <>
                <p className="side-title">No arrivals waiting</p>
                <p className="muted small">Confirmed bookings appear here before the guest arrives.</p>
              </>
            )}
            <hr />
            <h2>Validate arrival</h2>
            <ButtonLink variant="secondary" block href={`/staff?${venueQuery}`}>
              <ScanLine size={18} aria-hidden="true" />
              Check PIN or scan guest QR
            </ButtonLink>
            <div className="notice warm">
              <Info size={19} aria-hidden="true" />
              <div>
                <strong>Check-in happens on Arrivals</strong>
                <p>Validate the QR or PIN there before marking the guest checked in.</p>
              </div>
            </div>
            <p className="fine-print">Never check in an unpaid or cancelled booking.</p>
          </Card>

          <Card aria-labelledby="workflow-heading">
            <h2 id="workflow-heading">Stay workflow</h2>
            <ol className="timeline">
              <li className="done">
                <span className="marker">
                  <Check size={13} aria-hidden="true" />
                </span>
                <div>
                  <strong>Confirm payment</strong>
                  <span>{nextArrival ? "Verified before the booking was confirmed" : "Done automatically when payment is verified"}</span>
                </div>
              </li>
              <li>
                <span className="marker">
                  <Clock3 size={13} aria-hidden="true" />
                </span>
                <div>
                  <strong>Validate &amp; check in</strong>
                  <span>{nextArrival ? "Waiting for arrival" : "When the guest arrives"}</span>
                </div>
              </li>
              <li>
                <span className="marker">
                  <Clock3 size={13} aria-hidden="true" />
                </span>
                <div>
                  <strong>Check out → Clean → Ready</strong>
                  <span>{nextArrival ? `Ends ${formatVenueTime(nextArrival.end_at)}, then cleaning` : "After the stay ends"}</span>
                </div>
              </li>
            </ol>
          </Card>
        </aside>
      </div>

      <div className="workspace-footer">
        <p>SIMPLY SIT · Partner portal</p>
        <p>
          <a href="/partner/apply">List another venue</a> · Last synced {syncedAt} IST · {todayShort}
        </p>
      </div>
    </main>
  );
}
