import { venueSearchQuerySchema } from "@simply-sit/contracts";
import { handle, ok, parseQuery } from "../../../../lib/api";
import { runVenueSearch } from "../../../../lib/search";

export const dynamic = "force-dynamic";

// GET /api/v1/venues - published venues by pilot area or coarse location, slot availability and filters (docs/07 s.2).
// Advisory only: holds re-check under locks. Unknown filters are rejected; search coordinates are never logged.
export function GET(request: Request) {
  return handle(async (requestId) => ok(requestId, await runVenueSearch(parseQuery(request, venueSearchQuerySchema))));
}
