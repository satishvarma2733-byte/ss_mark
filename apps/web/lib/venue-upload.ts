// Shared partner upload flow for venue photos and the venue logo. Multipart `file` + `alt_text`; JPEG/PNG/WebP by
// content (not the declared type), at most MEDIA_MAX_BYTES. The database row is recorded first (permissions, limits),
// then the bytes go to the private bucket as the manager; if Storage refuses, the row is withdrawn. Nothing is public
// until platform approval.
import { MEDIA_MAX_BYTES } from "@simply-sit/contracts";
import { asUser, DomainError, getDb, partnerRemoveMedia, type Tx } from "@simply-sit/db";
import { assertSameOrigin, handle, ok, parseUuid } from "./api";
import { requireUser } from "./auth/identity";
import { sniffImage, uploadVenueObject } from "./media";

type Record = (tx: Tx, venueId: string, mediaId: string, key: string, altText: string, requestId: string) => Promise<unknown>;

export function venueUploadRoute(request: Request, params: Promise<{ id: string }>, record: Record) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    assertSameOrigin(request, identity.via);
    const venueId = parseUuid((await params).id);
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
    const recorded = await asUser(getDb(), identity.claims, (tx) => record(tx, venueId, mediaId, key, altText, requestId));
    try {
      await uploadVenueObject(key, bytes, kind, identity.accessToken);
    } catch (error) {
      await asUser(getDb(), identity.claims, (tx) => partnerRemoveMedia(tx, mediaId, requestId)).catch(() => undefined);
      throw error;
    }
    return ok(requestId, recorded, 201);
  });
}
