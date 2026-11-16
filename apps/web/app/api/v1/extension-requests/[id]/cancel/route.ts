import { cancelExtension } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/extension-requests/{id}/cancel - the customer withdraws an open extension; held time is released.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, {}, async ({ tx, requestId }) => cancelExtension(tx, await idParam(context), requestId));
}
