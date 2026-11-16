import { payoutCreateSchema } from "@simply-sit/contracts";
import { createPayoutBatch } from "@simply-sit/db";
import { authedRoute } from "../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/admin/payout-batches {partner_id} - drafts a payout of the partner's available earnings less refund
// adjustments (finance + TOTP). One open batch per partner; a net of zero or less is carried forward.
export function POST(request: Request) {
  return authedRoute(request, { schema: payoutCreateSchema, idempotencyRoute: "POST /admin/payout-batches", status: 201 },
    ({ tx, body, requestId }) => createPayoutBatch(tx, body.partner_id, requestId));
}
