import type { Metadata } from "next";
import { Montserrat, Playfair_Display } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { SYNTHETIC_BANNER } from "@simply-sit/synthetic-data";
import { SiteNav } from "../components/site-nav";
import { ToastProvider } from "../components/ui";
import "./globals.css";
import "../components/ui/ui.css";

// Brand type from the Figma design: Montserrat for interface text, Playfair Display for editorial headlines.
// next/font downloads both (SIL Open Font Licence) at build time and serves them from this app.
const montserrat = Montserrat({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-montserrat", display: "swap" });
const playfair = Playfair_Display({ subsets: ["latin"], weight: ["400"], variable: "--font-playfair", display: "swap" });

export const metadata: Metadata = {
  title: "Simply Sit - Your Space. Your Time.",
  description: "Reserve time at partner hospitality spaces. Synthetic data preview."
};

const THEME_SCRIPT = `try{var t=localStorage.getItem("ss-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" className={`${montserrat.variable} ${playfair.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies a saved light/dark choice before first paint, so the page does not flash the other theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <Link className="brand" href="/" aria-label="Simply Sit home">
            {/* Owner-supplied horizontal lockup, white for the olive header (wordmark and tagline are part of the artwork). */}
            <img className="brand-logo" src="/brand/logo-horizontal-white.png" alt="Simply Sit. Your Space. Your Time." width={200} height={41} />
          </Link>
          <SiteNav />
        </header>
        <div className="mock-banner" role="note">
          {SYNTHETIC_BANNER}
        </div>
        <ToastProvider>
          <div id="main">{children}</div>
        </ToastProvider>
        <footer className="site-footer">
          <span className="footer-logos">
            <img className="logo-on-light" src="/brand/logo-horizontal-olive.png" alt="Simply Sit. Your Space. Your Time." width={180} height={37} />
            <img className="logo-on-dark" src="/brand/logo-horizontal-white.png" alt="" aria-hidden="true" width={180} height={37} />
          </span>
          <nav aria-label="Footer">
            <Link href="/help">Help &amp; safety</Link>
            <Link href="/partner/apply">Partner with us</Link>
            <Link href="/partner">Partner portal</Link>
            <Link href="/staff">Staff arrivals</Link>
            <Link href="/admin">Admin</Link>
          </nav>
        </footer>
      </body>
    </html>
  );
}
