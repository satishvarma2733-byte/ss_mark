"use client";

// Figma "Marketplace navigation": three text links, an area pill and an account icon. Notifications sit beside the
// account icon so the existing /notifications page stays one click away. Partner, staff and admin links are in the footer.
// On phones the three text links become a fixed bottom tab bar (globals.css "Polish layer"); the icons show only there.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarCheck, CircleUserRound, Compass, LifeBuoy, MapPin } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";

const LINKS = [
  { href: "/", label: "Explore spaces", icon: Compass, match: (p: string) => p === "/" || p.startsWith("/venues") },
  { href: "/bookings", label: "My bookings", icon: CalendarCheck, match: (p: string) => p.startsWith("/bookings") || p.startsWith("/checkout") },
  { href: "/help", label: "Help", icon: LifeBuoy, match: (p: string) => p.startsWith("/help") || p.startsWith("/support") }
];

export function SiteNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="site-nav" aria-label="Primary">
      <span className="site-nav-links">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} aria-current={link.match(pathname) ? "page" : undefined}>
            <link.icon className="tab-icon" size={22} aria-hidden="true" />
            {link.label}
          </Link>
        ))}
      </span>
      <Link className="nav-pill" href="/venues" aria-label="Browse spaces in Bengaluru">
        <MapPin size={15} aria-hidden="true" />
        Bengaluru
      </Link>
      <ThemeToggle />
      <Link className="nav-icon" href="/notifications" aria-label="Notifications" aria-current={pathname.startsWith("/notifications") ? "page" : undefined}>
        <Bell size={22} aria-hidden="true" />
      </Link>
      <Link className="nav-icon" href="/account" aria-label="Account" aria-current={pathname.startsWith("/account") ? "page" : undefined}>
        <CircleUserRound size={26} aria-hidden="true" />
      </Link>
    </nav>
  );
}
