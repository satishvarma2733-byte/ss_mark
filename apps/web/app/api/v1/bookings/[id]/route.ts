import { handle, ok, parseUuid } from "../../../../../lib/api";
import { requireUser } from "../../../../../lib/auth/identity";
import { loadBookingDetail } from "../../../../../lib/bookings";

export const dynamic = "force-dynamic";

// GET /api/v1/bookings/{id} - owner only (another customer's ID is 404). Arrival QR token/PIN only once CONFIRMED.
export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    const id = parseUuid((await context.params).id);
    return ok(requestId, await loadBookingDetail(identity.claims, id));
  });
}
