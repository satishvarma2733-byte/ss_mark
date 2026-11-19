import { seatMapQuerySchema } from "@simply-sit/contracts";
import { asAnon, getDb, venueSeatMap } from "@simply-sit/db";
import { handle, ok, parseQuery, parseUuid } from "../../../../../../lib/api";
import { customerPrice } from "../../../../../../lib/price";

export const dynamic = "force-dynamic";

// GET /api/v1/venues/{id}/seat-map?start_at&duration_minutes&party_size - each active table's state (FREE, BOOKED,
// TOO_SMALL, UNAVAILABLE) and price for one start time. Advisory (no-store); the hold is the only commitment.
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const id = parseUuid((await context.params).id);
    const query = parseQuery(request, seatMapQuerySchema);
    const result = await asAnon(getDb(), (tx) => venueSeatMap(tx, id, query.start_at, query.duration_minutes, query.party_size));
    const tables = (result.tables as { price: unknown }[]).map((t) => ({ ...t, price: customerPrice(t.price) }));
    return ok(requestId, { ...result, tables });
  });
}
