// Shared shape of an authenticated JSON route (docs/07 s.1): one identity (cookie or bearer), same-origin check for
// cookie mutations, optional Idempotency-Key, strict body validation, and the work inside one asUser transaction so the
// database re-checks membership/role/TOTP with RLS in force. Domain errors map to HTTP in `handle`.
import type { z } from "zod";
import { asUser, getDb, type Tx } from "@simply-sit/db";
import { assertSameOrigin, handle, idempotent, ok, parseBody, parseUuid, requireIdempotencyKey } from "./api";
import { requireUser, type Identity } from "./auth/identity";
import { assertSupportedClient } from "./service-status";

type User = Extract<Identity, { kind: "user" }>;

export type RouteContext<B> = { tx: Tx; body: B; requestId: string; identity: User };

export function authedRoute<B = undefined>(
  request: Request,
  options: { schema?: z.ZodType<B>; idempotencyRoute?: string; status?: number; startsCommitment?: boolean },
  work: (ctx: RouteContext<B>) => Promise<unknown>
): Promise<Response> {
  return handle(async (requestId) => {
    const identity = await requireUser();
    if (request.method !== "GET") assertSameOrigin(request, identity.via);
    if (options.startsCommitment) assertSupportedClient(request);
    const key = options.idempotencyRoute ? requireIdempotencyKey(request) : null;
    const body = (options.schema ? await parseBody(request, options.schema) : undefined) as B;
    const status = options.status ?? 200;
    const result = await asUser(getDb(), identity.claims, (tx) =>
      key && options.idempotencyRoute
        ? idempotent(tx, options.idempotencyRoute, key, body ?? {}, async () => ({ status, data: await work({ tx, body, requestId, identity }) }))
        : work({ tx, body, requestId, identity }).then((data) => ({ status, data }))
    );
    return ok(requestId, result.data, result.status);
  });
}

// Route params are UUIDs; anything else is NOT_FOUND (never a 500 from a bad cast).
export async function idParam(context: { params: Promise<Record<string, string>> }, name = "id"): Promise<string> {
  return parseUuid((await context.params)[name] ?? "");
}
