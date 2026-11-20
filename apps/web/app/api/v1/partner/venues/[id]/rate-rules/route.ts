import { rateRuleCreateSchema } from "@simply-sit/contracts";
import { partnerCreateRateRule } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/venues/{id}/rate-rules - add a busy-hour rule (days, local time window, +/- adjustment) for the
// whole venue or one area. Applies to quotes made after it; quotes and bookings already made keep their price.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; // label only; validated inside the transaction
  return authedRoute(request, { schema: rateRuleCreateSchema, idempotencyRoute: `POST /partner/venues/${id}/rate-rules`, status: 201 },
    async ({ tx, body, requestId }) => partnerCreateRateRule(tx, await idParam(context), body, requestId));
}
