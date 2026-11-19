import { asAnon, getDb, venueSeating } from "@simply-sit/db";
import { handle, ok, parseUuid } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

// GET /api/v1/venues/{id}/seating - the venue's seating areas with their "from" price and published floor drawing
// (tables with shape, features, approved photo and current hourly rate). Unpublished venue -> 404.
export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const id = parseUuid((await context.params).id);
    return ok(requestId, await asAnon(getDb(), (tx) => venueSeating(tx, id)));
  });
}
