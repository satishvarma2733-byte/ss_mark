// Admin console shell (Figma "Admin · Marketplace overview"): dark sidebar with role-filtered sections and a white
// workspace bar. Pages render it inside their <main>; globals.css lays it out beside the content (portal-shell rules).
// UI only: every admin page and API re-checks the caller's platform role.
import { ThemeToggle } from "../components/theme-toggle";
import { BadgeCheck, Bell, ChartColumn, CircleHelp, CircleUserRound, FileText, LayoutDashboard, Settings, ShieldCheck, Star, Store, Tickets, ToggleRight, UserCog, Users, Wallet } from "lucide-react";

type Role = "SUPERADMIN" | "SUPPORT" | "FINANCE" | string;

const SECTIONS = [
  { path: "/admin", label: "Overview", icon: LayoutDashboard, roles: null },
  { path: "/admin/venues", label: "Partner review", icon: BadgeCheck, roles: ["SUPERADMIN", "SUPPORT"] },
  { path: "/admin/directory", label: "Venue directory", icon: Store, roles: ["SUPERADMIN", "SUPPORT"] },
  { path: "/admin/customers", label: "Customers", icon: Users, roles: ["SUPERADMIN", "SUPPORT"] },
  { path: "/admin/bookings", label: "Booking operations", icon: Tickets, roles: null },
  { path: "/admin/finance", label: "Finance", icon: Wallet, roles: ["SUPERADMIN", "FINANCE"] },
  { path: "/admin/support", label: "Trust & support", icon: ShieldCheck, roles: ["SUPERADMIN", "SUPPORT"] },
  { path: "/admin/reviews", label: "Review moderation", icon: Star, roles: ["SUPERADMIN", "SUPPORT"] },
  { path: "/admin/metrics", label: "Metrics", icon: ChartColumn, roles: null },
  { path: "/admin/users", label: "Admin permissions", icon: UserCog, roles: ["SUPERADMIN"] },
  { path: "/admin/audit", label: "Audit log", icon: FileText, roles: null },
  { path: "/admin/release", label: "Release switches", icon: ToggleRight, roles: null },
  { path: "/admin/settings", label: "System settings", icon: Settings, roles: null }
] as const;

const ROLE_LABEL: Record<string, string> = { SUPERADMIN: "Superadmin", SUPPORT: "Support admin", FINANCE: "Finance admin" };
const TEST_IDS: Record<string, string> = {
  "/admin/venues": "admin-venues-link",
  "/admin/support": "admin-support-link",
  "/admin/metrics": "admin-metrics-link",
  "/admin/finance": "admin-finance-link",
  "/admin/release": "admin-release-link"
};

export function AdminNav({ roles, active }: { roles: Role[]; active: string }) {
  const visible = SECTIONS.filter((s) => s.roles === null || s.roles.some((r) => roles.includes(r)));
  const current = visible.find((s) => s.path === active) ?? visible.find((s) => s.path !== "/admin" && active.startsWith(s.path));
  return (
    <>
      <aside className="portal-sidebar" aria-label="Marketplace admin">
        <a className="brand" href="/">
          <img className="brand-mark" src="/brand/monogram-cream.png" alt="" width={40} height={30} />
          <span className="brand-name">
            <strong>SIMPLY SIT</strong>
            <small>Your Space. Your Time.</small>
          </span>
        </a>
        <p className="portal-label">Marketplace admin</p>
        <nav aria-label="Admin sections" className="portal-nav">
          {visible.map((s) => (
            <a key={s.path} href={s.path} aria-current={s === current ? "page" : undefined} data-testid={TEST_IDS[s.path]}>
              <s.icon size={18} aria-hidden="true" />
              {s.label}
            </a>
          ))}
        </nav>
        <div className="portal-access">
          <strong>{roles.map((r) => ROLE_LABEL[r] ?? r).join(" · ")}</strong>
          <span>Operations admin · India</span>
          <span className="portal-access-note">Sensitive actions are audited</span>
          <a href="/help">
            <CircleHelp size={16} aria-hidden="true" />
            Support centre
          </a>
        </div>
      </aside>
      <div className="portal-topbar">
        <p className="portal-breadcrumb">Marketplace / {current && current.path !== "/admin" ? current.label : "Operations"}</p>
        <div className="portal-utilities">
          <span>Asia/Kolkata · IST</span>
          <ThemeToggle className="portal-theme-toggle" />
          <a href="/admin/notifications" aria-label="Notifications" aria-current={active === "/admin/notifications" ? "page" : undefined}>
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
