import { adminBookingDetail } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/bookings/{id} - timeline with payments, refunds, extensions and visible tickets; audited view.
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, {}, async ({ tx, requestId }) => adminBookingDetail(tx, await idParam(context), requestId));
}
