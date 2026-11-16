import { asAnon, DomainError, getDb, venueDetail, venuePhotos, venueReviews } from "@simply-sit/db";
import { handle, ok, parseUuid } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

// GET /api/v1/venues/{id} - sanitized published detail: rules, food/delivery status, tables, hours and approved photos.
// Unpublished -> 404.
export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const id = parseUuid((await context.params).id);
    const detail = await asAnon(getDb(), async (tx) => {
      const venue = await venueDetail(tx, id);
      return venue ? { ...venue, photos: await venuePhotos(tx, id), reviews: await venueReviews(tx, id) } : null;
    });
    if (!detail) throw new DomainError("NOT_FOUND");
    return ok(requestId, detail);
  });
}
