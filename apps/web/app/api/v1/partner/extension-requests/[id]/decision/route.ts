import { extensionDecisionSchema } from "@simply-sit/contracts";
import { decideExtension } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/extension-requests/{id}/decision - the venue's staff (TOTP) approve or decline within five minutes
// of the request. Approval checks it still looks possible but reserves nothing; the customer then has five minutes.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; // label only; validated inside the transaction
  return authedRoute(request, { schema: extensionDecisionSchema, idempotencyRoute: `POST /partner/extension-requests/${id}/decision` },
    async ({ tx, body, requestId }) => decideExtension(tx, await idParam(context), body, requestId));
}
