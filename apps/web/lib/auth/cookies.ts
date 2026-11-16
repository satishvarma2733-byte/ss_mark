// Cookie policy shared by route handlers and proxy.ts (no next/headers import, so the proxy can use it).
import type { CookieOptions } from "@supabase/ssr";

// Session cookies are httpOnly: every auth action (OTP, MFA, sign-out) goes through server routes, so no browser
// script ever needs to read them (docs/02 s.5 secure session cookies).
export function hardenCookie(options: CookieOptions = {}): CookieOptions {
  const secure = (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://");
  return { ...options, httpOnly: true, sameSite: "lax", path: "/", secure };
}

export function hasSupabaseSessionCookie(cookieNames: string[]): boolean {
  return cookieNames.some((name) => name.startsWith("sb-") && name.includes("-auth-token"));
}
