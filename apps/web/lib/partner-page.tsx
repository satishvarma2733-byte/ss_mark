// Partner portal page context: signed in, TOTP-verified, and a venue chosen from the caller's own memberships
// (?venue=, else the first). UI gating only; every API call and database function re-checks membership and role.
import { ThemeToggle } from "../components/theme-toggle";
import {
  Armchair, Bell, CalendarRange, CircleHelp, CircleUserRound, LayoutDashboard, ScanLine, Store, Users, Wallet
} from "lucide-react";
import type { Me } from "@simply-sit/contracts";
import { gatePortal, type PortalGate } from "./portal-page";

export type Membership = Me["venue_memberships"][number];
export type PartnerContext =
  | { state: "blocked"; gate: Exclude<PortalGate, { state: "ok" }> }
  | { state: "not_manager"; current: Membership; memberships: Membership[] }
  | { state: "ok"; gate: Extract<PortalGate, { state: "ok" }>; current: Membership; memberships: Membership[] };

export async function partnerContext(path: string, venue: string | undefined, options: { manager?: boolean } = {}): Promise<PartnerContext> {
  // Keep the chosen venue across the TOTP step (the return path is validated as an internal path).
  const returnPath = venue && /^[0-9a-f-]{36}$/i.test(venue) ? `${path}?venue=${venue}` : path;
  const gate = await gatePortal(returnPath, (me) => me.venue_memberships.length > 0);
  if (gate.state !== "ok") return { state: "blocked", gate };
  const memberships = gate.me.venue_memberships;
  const current = memberships.find((m) => m.venue_id === venue) ?? memberships[0]!;
  if (options.manager && current.role === "STAFF") return { state: "not_manager", current, memberships };
  return { state: "ok", gate, current, memberships };
}

const TABS = [
  { path: "/partner", label: "Today", manager: false, icon: LayoutDashboard },
  { path: "/partner/calendar", label: "Calendar", manager: false, icon: CalendarRange },
  { path: "/staff", label: "Arrivals", manager: false, icon: ScanLine },
  { path: "/partner/inventory", label: "Inventory", manager: true, icon: Armchair },
  { path: "/partner/venue", label: "Venue profile", manager: true, icon: Store },
  { path: "/partner/reports", label: "Earnings", manager: true, icon: Wallet },
  { path: "/partner/staff", label: "Team & access", manager: true, icon: Users }
];

const ROLE_LABEL: Record<string, string> = { OWNER: "Venue owner", MANAGER: "Venue manager", STAFF: "Venue staff" };

// Figma "Partner · Today and booking operations": dark sidebar (brand, workspace label, selected venue, sections,
// signed-in role) and a white workspace bar. Pages render this inside their <main>; globals.css lays it out beside the
// content when present and hides the customer header (portal-shell rules).
export function PartnerNav({ current, memberships, active }: { current: Membership; memberships: Membership[]; active: string }) {
  const isManager = current.role !== "STAFF";
  return (
    <>
      <aside className="portal-sidebar" aria-label="Partner workspace">
        <a className="brand" href="/">
          <img className="brand-mark" src="/brand/monogram-cream.png" alt="" width={40} height={30} />
          <span className="brand-name">
            <strong>SIMPLY SIT</strong>
            <small>Your Space. Your Time.</small>
          </span>
        </a>
        <p className="portal-label">Partner workspace</p>
        {memberships.length > 1 ? (
          <nav aria-label="Venue" className="venue-switcher">
            {memberships.map((m) => (
              <a key={m.venue_id} href={`${active}?venue=${m.venue_id}`} aria-current={m.venue_id === current.venue_id ? "page" : undefined}>
                <strong>{m.venue_name}</strong>
                <span>{ROLE_LABEL[m.role] ?? m.role}</span>
              </a>
            ))}
          </nav>
        ) : (
          <div className="selected-venue-card">
            <strong>{current.venue_name}</strong>
            <span>{ROLE_LABEL[current.role] ?? current.role}</span>
          </div>
        )}
        <nav aria-label="Partner sections" className="portal-nav">
          {TABS.filter((t) => isManager || !t.manager).map((t) => (
            <a key={t.path} href={`${t.path}?venue=${current.venue_id}`} aria-current={t.path === active ? "page" : undefined}>
              <t.icon size={18} aria-hidden="true" />
              {t.label}
            </a>
          ))}
        </nav>
        <div className="portal-access">
          <strong>{ROLE_LABEL[current.role] ?? current.role}</strong>
          <span>{isManager ? "Operations and venue settings" : "Arrivals and table readiness"}</span>
          {current.role !== "OWNER" ? <span className="portal-access-note">Owner-only finance controls locked</span> : null}
          <a href="/help">
            <CircleHelp size={16} aria-hidden="true" />
            Support centre
          </a>
        </div>
      </aside>
      <div className="portal-topbar">
        <p className="portal-breadcrumb">{current.venue_name} / Workspace</p>
        <div className="portal-utilities">
          <span>Asia/Kolkata · IST</span>
          <ThemeToggle className="portal-theme-toggle" />
          <a href={`/partner/notifications?venue=${current.venue_id}`} aria-label="Notifications" aria-current={active === "/partner/notifications" ? "page" : undefined}>
            <Bell size={19} aria-hidden="true" />
          </a>
          <a className="portal-avatar" href="/account" aria-label="Account">
            <CircleUserRound size={20} aria-hidden="true" />
          </a>
        </div>
      </div>
    </>
  );
}

export function NotManager({ current }: { current: Membership }) {
  return (
    <main>
      <h1>Managers only</h1>
      <p className="notice" data-testid="partner-not-manager">
        This area is for the managers of {current.venue_name}. Ask a manager if something needs changing.
      </p>
      <p>
        <a href={`/partner?venue=${current.venue_id}`}>Back to today</a>
      </p>
    </main>
  );
}
