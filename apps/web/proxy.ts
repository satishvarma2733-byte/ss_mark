// Next 16 proxy (formerly middleware): refreshes the Supabase session cookie before pages render, because server
// components cannot write cookies. API routes refresh through their own server client and are excluded here.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hardenCookie, hasSupabaseSessionCookie } from "./lib/auth/cookies";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !hasSupabaseSessionCookie(request.cookies.getAll().map((c) => c.name))) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, hardenCookie(options));
      }
    }
  });
  // Validates with the Auth server and rotates the access token when needed.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"]
};
