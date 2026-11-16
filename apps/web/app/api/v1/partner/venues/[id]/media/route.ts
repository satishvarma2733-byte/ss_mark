import { MEDIA_MAX_BYTES } from "@simply-sit/contracts";
import { asUser, DomainError, getDb, partnerAddMedia, partnerRemoveMedia } from "@simply-sit/db";
import { assertSameOrigin, handle, ok, parseUuid } from "../../../../../../../lib/api";
import { requireUser } from "../../../../../../../lib/auth/identity";
import { sniffImage, uploadVenueObject } from "../../../../../../../lib/media";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/venues/{id}/media - multipart `file` + `alt_text`. JPEG/PNG/WebP by content (not the declared
// type), at most 5 MB. The database row is recorded first (permissions, limits), then the bytes go to the private
// bucket as the manager; if Storage refuses, the row is withdrawn. The photo stays private until platform approval.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    assertSameOrigin(request, identity.via);
    const venueId = parseUuid((await context.params).id);
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(declared) || declared > MEDIA_MAX_BYTES + 64 * 1024) throw new DomainError("VALIDATION_FAILED", { field: "file", reason: "too_large" });
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new DomainError("MALFORMED_REQUEST", { field: "file" });
    }
    const file = form.get("file");
    const altText = form.get("alt_text");
    if (!(file instanceof File) || typeof altText !== "string") throw new DomainError("VALIDATION_FAILED", { field: "file" });
    if (file.size === 0 || file.size > MEDIA_MAX_BYTES) throw new DomainError("VALIDATION_FAILED", { field: "file", reason: "size" });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniffImage(bytes);
    if (!kind) throw new DomainError("VALIDATION_FAILED", { field: "file", reason: "type" });

    const mediaId = crypto.randomUUID();
    const key = `${venueId}/${mediaId}.${kind.ext}`;
    const recorded = await asUser(getDb(), identity.claims, (tx) => partnerAddMedia(tx, venueId, mediaId, key, altText, requestId));
    try {
      await uploadVenueObject(key, bytes, kind, identity.accessToken);
    } catch (error) {
      await asUser(getDb(), identity.claims, (tx) => partnerRemoveMedia(tx, mediaId, requestId)).catch(() => undefined);
      throw error;
    }
    return ok(requestId, recorded, 201);
  });
}
