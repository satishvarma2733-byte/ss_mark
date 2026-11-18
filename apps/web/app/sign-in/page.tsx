import { safeRedirectPath } from "../../lib/api";
import { SignInForm } from "./sign-in-form";
import { StatusPill } from "../../components/ui";

export const dynamic = "force-dynamic";

// C02 /sign-in - email one-time code (proposed, docs/03). Only internal return paths are honoured.
// Layout follows Figma "E · Customer web · Sign-in and OTP". The design shows phone + SMS; the app signs in by email
// until a phone OTP provider is decided, so the copy names email instead.
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ redirect_path?: string }> }) {
  const { redirect_path } = await searchParams;
  return (
    <main className="customer-page">
      <p className="page-crumbs">SIMPLY SIT / Your account / Sign in</p>
      <div className="customer-page-intro">
        <h1>Your next good hour starts here.</h1>
        <p className="lede">Secure sign-in with a six-digit code. No password needed.</p>
      </div>
      <div className="auth-layout">
        <aside className="auth-aside">
          <span className="auth-logos">
            <img className="logo-on-light" src="/brand/logo-stacked-olive.png" alt="Simply Sit" width={150} height={91} />
            <img className="logo-on-dark" src="/brand/logo-stacked-white.png" alt="" aria-hidden="true" width={150} height={91} />
          </span>
          {/* Decorative venue photograph from the Figma frame; the copy beside it carries the meaning. */}
          <img className="auth-photo" src="/design/sign-in-venue.jpg" alt="" width={1584} height={672} />
          <h2 className="auth-aside-title">A little space. All yours.</h2>
          <p className="muted">Reserve a table, not a compulsory meal. Keep your bookings, receipts and support in one place.</p>
          <StatusPill tone="sage">
            <img src="/design/status-dot-brand.svg" alt="" width={5} height={5} />
            No password or identity document needed
          </StatusPill>
        </aside>
        <SignInForm redirectPath={safeRedirectPath(redirect_path)} />
      </div>
    </main>
  );
}
