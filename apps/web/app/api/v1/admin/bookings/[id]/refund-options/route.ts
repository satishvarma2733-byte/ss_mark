import { adminRefundOptions } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/bookings/{id}/refund-options - what finance may refund on this booking and who would bear it.
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, {}, async ({ tx }) => adminRefundOptions(tx, await idParam(context)));
}
