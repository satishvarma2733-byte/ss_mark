import { calendarQuerySchema } from "@simply-sit/contracts";
import { partnerCalendar } from "@simply-sit/db";
import { parseQuery } from "../../../../../../../lib/api";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET /api/v1/partner/venues/{id}/calendar?from&to - assigned staff (TOTP): bookings, closures and table readiness
// without prices or customer identifiers (P05). Range up to 14 days.
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, {}, async ({ tx }) => {
    const query = parseQuery(request, calendarQuerySchema);
    return partnerCalendar(tx, await idParam(context), query.from, query.to);
  });
}
