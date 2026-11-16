import { adminReconciliationRun } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/reconciliation/{id} - one run with its exceptions (first 200).
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, {}, async ({ tx }) => adminReconciliationRun(tx, await idParam(context)));
}
