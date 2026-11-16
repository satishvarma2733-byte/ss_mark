import { bookingListQuerySchema, decodeCursor, encodeCursor } from "@simply-sit/contracts";
import { asUser, customerBookings, DomainError, getDb } from "@simply-sit/db";
import { handle, ok, parseQuery } from "../../../../lib/api";
import { requireUser } from "../../../../lib/auth/identity";

export const dynamic = "force-dynamic";

// GET /api/v1/bookings?scope=upcoming|past|all - the caller's own bookings with separate booking/payment/refund states.
export function GET(request: Request) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    const query = parseQuery(request, bookingListQuerySchema);
    const offset = decodeCursor(query.cursor);
    if (offset === "invalid") throw new DomainError("INVALID_CURSOR");
    const page = await asUser(getDb(), identity.claims, (tx) => customerBookings(tx, query.scope, offset, 20));
    return ok(requestId, {
      bookings: page.bookings,
      total: page.total,
      next_cursor: page.next_offset === null ? null : encodeCursor(page.next_offset)
    });
  });
}
