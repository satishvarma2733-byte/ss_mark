import { markNotificationsRead } from "@simply-sit/db";
import { authedRoute } from "../../../../../lib/route";

export const dynamic = "force-dynamic";

// POST /api/v1/notifications/read-all - marks every unread in-app notification of the caller read.
export function POST(request: Request) {
  return authedRoute(request, {}, ({ tx }) => markNotificationsRead(tx, null));
}
