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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" className={`${montserrat.variable} ${playfair.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <Link className="brand" href="/">
            {/* Owner-supplied monogram (references/brand/logo). Decorative here: the link text names the brand. */}
            <img className="brand-mark" src="/brand/monogram-cream.png" alt="" width={40} height={30} />
            <span className="brand-name">
              <strong>SIMPLY SIT</strong>
              <small>Your Space. Your Time.</small>
            </span>
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
          <p className="footer-brand">SIMPLY SIT · Your Space. Your Time.</p>
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
