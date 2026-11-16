import { bookingSearchQuerySchema } from "@simply-sit/contracts";
import { adminBookingSearch } from "@simply-sit/db";
import { parseQuery } from "../../../../../lib/api";
import { authedRoute } from "../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/bookings?ref|venue_id|date|email - bounded lookup for support/finance with TOTP (50 results);
// searching by a customer's email is audited.
export function GET(request: Request) {
  return authedRoute(request, {}, ({ tx, requestId }) => adminBookingSearch(tx, parseQuery(request, bookingSearchQuerySchema), requestId));
}
