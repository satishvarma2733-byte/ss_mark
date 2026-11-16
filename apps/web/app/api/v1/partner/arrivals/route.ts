import { arrivalsQuerySchema } from "@simply-sit/contracts";
import { asUser, getDb, staffArrivals } from "@simply-sit/db";
import { handle, ok, parseQuery } from "../../../../../lib/api";
import { requireUser } from "../../../../../lib/auth/identity";
import { venueLocalDate } from "../../../../../lib/format";

export const dynamic = "force-dynamic";

// GET /api/v1/partner/arrivals?venue_id&date - assigned, MFA-verified staff: today's confirmed arrivals and table
// readiness. Minimal data only: reference, time, party size, table; no customer identity, contact or money.
export function GET(request: Request) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    const query = parseQuery(request, arrivalsQuerySchema);
    const result = await asUser(getDb(), identity.claims, (tx) => staffArrivals(tx, query.venue_id, query.date ?? venueLocalDate()));
    return ok(requestId, result);
  });
}
