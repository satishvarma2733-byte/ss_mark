import { incidentCreateSchema } from "@simply-sit/contracts";
import { staffReportIncident } from "@simply-sit/db";
import { authedRoute } from "../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/incidents - venue staff (TOTP) report an incident at their venue, optionally about one booking
// there. Staff see only their own reports.
export function POST(request: Request) {
  return authedRoute(request, { schema: incidentCreateSchema, idempotencyRoute: "POST /partner/incidents", status: 201 },
    ({ tx, body, requestId }) => staffReportIncident(tx, body, requestId));
}
