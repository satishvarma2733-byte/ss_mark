"use client";

// Portal form actions: one pending action at a time, the server's safe message on failure (the form keeps its input),
// and a server-data refresh on success. A create/decision action keeps the same Idempotency-Key until it succeeds, so a
// retry after a lost response cannot apply twice.
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { apiCall, newIdempotencyKey, type ApiResult } from "./client-api";

export type ActionMessage = { tone: "success" | "error" | "warning"; text: string };

export function useAction() {
  const router = useRouter();
  const keys = useRef(new Map<string, string>());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const [details, setDetails] = useState<Record<string, unknown> | null>(null);

  async function run<T>(
    name: string,
    method: "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    options: { idempotent?: boolean; success?: string; refresh?: boolean } = {}
  ): Promise<ApiResult<T>> {
    setBusy(name);
    setMessage(null);
    setDetails(null);
    let key: string | undefined;
    if (options.idempotent) {
      key = keys.current.get(name) ?? newIdempotencyKey();
      keys.current.set(name, key);
    }
    const result = await apiCall<T>(method, path, { body, ...(key ? { idempotencyKey: key } : {}) });
    setBusy(null);
    if (result.ok) {
      keys.current.delete(name);
      if (options.success) setMessage({ tone: "success", text: options.success });
      if (options.refresh !== false) router.refresh();
    } else {
      // A definitive refusal is a new decision for the user: the next attempt is a new operation.
      if (result.status !== 0 && result.status < 500) keys.current.delete(name);
      const field = typeof result.details?.field === "string" ? ` (${String(result.details.field).replace(/_/g, " ")})` : "";
      setMessage({ tone: "error", text: `${result.message}${field}` });
      setDetails(result.details ?? null);
    }
    return result;
  }

  return { busy, message, details, run, clear: () => { setMessage(null); setDetails(null); } };
}

// Conflicting bookings returned with a 409 (closures, hours, capacity), shown as references the manager can resolve.
export type Conflict = { public_ref?: string; booking_status?: string; resource_label?: string; starts_at?: string; ends_at?: string; kind?: string };
export function conflictsOf(details: Record<string, unknown> | null): Conflict[] {
  return Array.isArray(details?.conflicts) ? (details.conflicts as Conflict[]) : [];
}
