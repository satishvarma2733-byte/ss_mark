import { asAnon, asUser, DomainError, getDb, mediaObject } from "@simply-sit/db";
import { errorResponse, handle, parseUuid } from "../../../../../lib/api";
import { resolveIdentity } from "../../../../../lib/auth/identity";
import { fetchVenueObject } from "../../../../../lib/media";

export const dynamic = "force-dynamic";

// GET /api/v1/media/{id} - venue photo bytes. Public when APPROVED on a PUBLISHED venue; otherwise only the venue's
// members and platform support (same rule in the database and in Storage). Others get 404.
export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const id = parseUuid((await context.params).id);
    const identity = await resolveIdentity();
    const object = identity.kind === "user"
      ? await asUser(getDb(), identity.claims, (tx) => mediaObject(tx, id))
      : await asAnon(getDb(), (tx) => mediaObject(tx, id));
    const upstream = await fetchVenueObject(object.storage_key, identity.kind === "user" ? identity.accessToken : null);
    if (upstream.status === 404 || upstream.status === 400 || upstream.status === 403) return errorResponse(requestId, "NOT_FOUND");
    if (!upstream.ok || !upstream.body) throw new DomainError("DEPENDENCY_UNAVAILABLE", { reason: "storage" });
    const type = upstream.headers.get("content-type") ?? "";
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return errorResponse(requestId, "NOT_FOUND");
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": type,
        "cache-control": object.public ? "public, max-age=300" : "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
        "x-request-id": requestId
      }
    });
  });
}
