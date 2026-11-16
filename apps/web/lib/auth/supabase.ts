// Server-only Supabase Auth clients. The publishable key is public by design; it is not authorization.
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { hardenCookie } from "./cookies";

export { hardenCookie, hasSupabaseSessionCookie } from "./cookies";

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase URL/publishable key not configured (run pnpm env:local)");
  return { url, key };
}

// For route handlers and server components. Server components cannot write cookies; proxy.ts refreshes them instead.
export async function createSupabaseServerClient() {
  const { url, key } = supabaseConfig();
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, hardenCookie(options));
        } catch {
          // Called from a server component render: ignore, the proxy persists refreshed cookies.
        }
      }
    }
  });
}

// Stateless client for verifying native bearer tokens; never persists or refreshes anything.
export function createSupabaseTokenClient() {
  const { url, key } = supabaseConfig();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
