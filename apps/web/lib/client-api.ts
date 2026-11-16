// Browser-side calls to our own API (cookie session, same origin). Safe for "use client" modules: no server imports.
// Mutations carry a stable Idempotency-Key per user action so a retried click or network replay is not a second action.
export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: string; message: string; retryable: boolean; details?: Record<string, unknown> };

export async function apiCall<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  options: { body?: unknown; idempotencyKey?: string } = {}
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      cache: "no-store"
    });
  } catch {
    return { ok: false, status: 0, code: "NETWORK", message: "You appear to be offline. Check your connection and try again.", retryable: true };
  }
  const json = (await response.json().catch(() => null)) as
    | { data?: T; error?: { code: string; message: string; retryable: boolean; details?: Record<string, unknown> } }
    | null;
  if (response.ok && json && "data" in json) return { ok: true, status: response.status, data: json.data as T };
  const error = json?.error;
  return {
    ok: false,
    status: response.status,
    code: error?.code ?? "UNEXPECTED_RESPONSE",
    message: error?.message ?? "Something went wrong. Try again.",
    retryable: error?.retryable ?? response.status >= 500,
    ...(error?.details ? { details: error.details } : {})
  };
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
