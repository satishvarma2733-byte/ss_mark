import { markNotificationsRead } from "@simply-sit/db";
import { authedRoute, idParam } from "../../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/notifications/{id}/read - records read_at on the caller's own notification (idempotent; 404 otherwise).
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authedRoute(request, {}, async ({ tx }) => markNotificationsRead(tx, await idParam(context)));
}
