// Route-handler plumbing: request IDs, the docs/07 envelope, body validation, origin checks and idempotency.
import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { DOMAIN_ERRORS, type DomainErrorCode } from "@simply-sit/contracts";
import { DomainError, idempotencyBegin, idempotencyComplete, toDomainError, type Tx } from "@simply-sit/db";
import type { z } from "zod";

const MAX_BODY_BYTES = 16 * 1024;
const NO_STORE = { "cache-control": "no-store" };

export function ok(requestId: string, data: unknown, status = 200) {
  return NextResponse.json({ data, request_id: requestId }, { status, headers: { ...NO_STORE, "x-request-id": requestId } });
}

export function errorResponse(
  requestId: string,
  code: DomainErrorCode,
  details: Record<string, unknown> = {},
  fieldErrors: Record<string, string> = {}
) {
  const meta = DOMAIN_ERRORS[code];
  const body = {
    error: {
      code,
      message: meta.message,
      retryable: meta.retryable,
      field_errors: fieldErrors,
      ...(Object.keys(details).length > 0 ? { details } : {})
    },
    request_id: requestId
  };
  const extra: Record<string, string> = code === "RATE_LIMITED" ? { "retry-after": "60" } : {};
  return NextResponse.json(body, { status: meta.status, headers: { ...NO_STORE, ...extra, "x-request-id": requestId } });
}

// Runs a handler with a request ID and maps domain errors; anything unexpected becomes a redacted 500.
export async function handle(work: (requestId: string) => Promise<Response>): Promise<Response> {
  const requestId = randomUUID();
  try {
    return await work(requestId);
  } catch (error) {
    const domain = toDomainError(error);
    if (domain) {
      const fieldErrors = typeof domain.details.field === "string" ? { [domain.details.field]: DOMAIN_ERRORS[domain.code].message } : {};
      return errorResponse(requestId, domain.code, domain.details, fieldErrors);
    }
    console.error(`[api] request ${requestId} failed: ${(error as Error)?.name ?? "Error"}`);
    return errorResponse(requestId, "INTERNAL_ERROR");
  }
}

// Reads a raw body without buffering more than `maxBytes` (unauthenticated endpoints such as webhooks; review F8).
export async function readBodyCapped(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new DomainError("MALFORMED_REQUEST", { reason: "body_too_large" });
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new DomainError("MALFORMED_REQUEST", { reason: "body_too_large" });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) throw new DomainError("MALFORMED_REQUEST", { reason: "body_too_large" });
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new DomainError("MALFORMED_REQUEST", { reason: "body_too_large" });
  let json: unknown;
  try {
    json = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new DomainError("MALFORMED_REQUEST", { reason: "invalid_json" });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "body"] = issue.message;
    throw new DomainError("VALIDATION_FAILED", { fields });
  }
  return parsed.data;
}

// Query strings use the same strict schemas: unknown parameters and invalid values are rejected, not ignored.
export function parseQuery<T extends z.ZodType>(request: Request, schema: T): z.infer<T> {
  const params: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (key in params) throw new DomainError("MALFORMED_REQUEST", { reason: "repeated_parameter", field: key });
    params[key] = value;
  }
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "query"] = issue.message;
    throw new DomainError("VALIDATION_FAILED", { fields });
  }
  return parsed.data;
}

export function parseUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new DomainError("NOT_FOUND");
  return value.toLowerCase();
}

export function allowedOrigins(): string[] {
  const configured = (process.env.APP_ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  const app = process.env.NEXT_PUBLIC_APP_URL;
  return [...new Set([...(app ? [new URL(app).origin] : []), ...configured])];
}

// CSRF defence for cookie-authenticated writes: the browser's Origin must be ours. Native bearer calls carry no
// ambient credentials, so they are exempt; a browser POST without Origin is rejected.
export function assertSameOrigin(request: Request, via: "cookie" | "bearer" | "none") {
  if (via === "bearer") return;
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) throw new DomainError("FORBIDDEN", { reason: "origin" });
}

// Only internal relative paths are allowed as post-sign-in destinations (docs/03 "validated sign-in return paths").
export function safeRedirectPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\r\n]/.test(value)) return "/";
  try {
    const url = new URL(value, "http://internal.invalid");
    if (url.origin !== "http://internal.invalid") return "/";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/";
  }
}

export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key");
  if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new DomainError("MALFORMED_REQUEST", { field: "Idempotency-Key" });
  }
  return key.toLowerCase();
}

// Begin, perform and record the outcome in the same transaction as the domain write (docs/07 s.1).
export async function idempotent(
  tx: Tx,
  route: string,
  key: string,
  body: unknown,
  work: () => Promise<{ status: number; data: unknown }>
): Promise<{ status: number; data: unknown; replayed: boolean }> {
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const begin = await idempotencyBegin(tx, route, key, hash);
  if (begin.state === "REPLAY") return { status: begin.http_status, data: begin.response, replayed: true };
  const result = await work();
  await idempotencyComplete(tx, route, key, result.status, result.data);
  return { ...result, replayed: false };
}
