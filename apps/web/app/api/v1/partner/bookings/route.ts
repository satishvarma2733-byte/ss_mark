import { z } from "zod";
import { asUser, DomainError, getDb, listVenueBookings } from "@simply-sit/db";
import { handle, ok } from "../../../../../lib/api";
import { requireUser } from "../../../../../lib/auth/identity";
import { requireVenueMember } from "../../../../../lib/portal";

export const dynamic = "force-dynamic";

// GET /api/v1/partner/bookings?venue_id= - assigned staff/manager calendar projection (no customer contact data).
export function GET(request: Request) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    const venueId = z.uuid().safeParse(new URL(request.url).searchParams.get("venue_id"));
    if (!venueId.success) throw new DomainError("VALIDATION_FAILED", { field: "venue_id" });
    await requireVenueMember(identity, venueId.data);
    const rows = await asUser(getDb(), identity.claims, (tx) => listVenueBookings(tx, venueId.data));
    return ok(requestId, { bookings: rows });
  });
}
