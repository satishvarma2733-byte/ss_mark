import { reasonSchema } from "@simply-sit/contracts";
import { partnerReleaseClosure } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/closures/{id}/release - end a blackout early (reason required, audited).
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, { schema: reasonSchema }, async ({ tx, body, requestId }) =>
    partnerReleaseClosure(tx, await idParam(context), body.reason, requestId));
}
