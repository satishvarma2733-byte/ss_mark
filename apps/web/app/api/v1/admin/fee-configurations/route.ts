import { feeConfigCreateSchema } from "@simply-sit/contracts";
import { adminCreateFeeConfig } from "@simply-sit/db";
import { authedRoute } from "../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/admin/fee-configurations - draft a future-dated fee version (finance + TOTP, audited). Another finance
// person approves it; existing rates and booking snapshots never change.
export function POST(request: Request) {
  return authedRoute(request, { schema: feeConfigCreateSchema, idempotencyRoute: "POST /admin/fee-configurations", status: 201 },
    ({ tx, body, requestId }) => adminCreateFeeConfig(tx, body, requestId));
}
