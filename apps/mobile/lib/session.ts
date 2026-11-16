// Current Supabase session for screens that need to know whether the customer is signed in. The session itself lives
// in secure storage (lib/supabase.ts); this only mirrors its presence for rendering.
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { supabase } from "./supabase";

export function useSession(): { ready: boolean; session: Session | null } {
  const [state, setState] = useState<{ ready: boolean; session: Session | null }>({ ready: !supabase, session: null });
  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setState({ ready: true, session: data.session }));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setState({ ready: true, session }));
    return () => data.subscription.unsubscribe();
  }, []);
  return state;
}

// Which allowlisted return target the provider should send this build back to (docs/02 s.5: per-variant schemes).
export function checkoutReturnTarget(): "native-dev" | "native-preview" {
  return Constants.expoConfig?.extra?.appVariant === "preview" ? "native-preview" : "native-dev";
}

// One stable key per user action, reused if the same action is retried.
export function newIdempotencyKey(): string {
  return Crypto.randomUUID();
}
