import { metricsQuerySchema } from "@simply-sit/contracts";
import { adminBusinessMetrics } from "@simply-sit/db";
import { parseQuery } from "../../../../../lib/api";
import { authedRoute } from "../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/metrics?from&to&venue_id - business metrics (support/finance/superadmin + TOTP): funnel, outcomes,
// occupancy, repeat customers and reliability; money only for finance roles, never collected money as revenue.
// Aggregates only: no contact details, coordinates or per-person rows. Definitions: contracts METRIC_DEFINITIONS.
export function GET(request: Request) {
  return authedRoute(request, {}, ({ tx }) => adminBusinessMetrics(tx, parseQuery(request, metricsQuerySchema)));
}
