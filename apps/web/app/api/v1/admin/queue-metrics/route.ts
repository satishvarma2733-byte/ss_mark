import { queueMetrics } from "@simply-sit/db";
import { authedRoute } from "../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/queue-metrics - queue lag, dead letters, due holds and worker heartbeats (superadmin/support + MFA,
// enforced inside app.queue_metrics). Moved from /admin/metrics, which now serves business metrics.
export function GET(request: Request) {
  return authedRoute(request, {}, ({ tx }) => queueMetrics(tx));
}
