import { decodeCursor, encodeCursor, notificationListQuerySchema } from "@simply-sit/contracts";
import { asUser, DomainError, getDb, myNotifications } from "@simply-sit/db";
import { handle, ok, parseQuery } from "../../../../lib/api";
import { requireUser } from "../../../../lib/auth/identity";

export const dynamic = "force-dynamic";

// GET /api/v1/notifications?cursor - the caller's in-app notifications, newest first, with the unread count.
export function GET(request: Request) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    const offset = decodeCursor(parseQuery(request, notificationListQuerySchema).cursor);
    if (offset === "invalid") throw new DomainError("INVALID_CURSOR");
    const page = await asUser(getDb(), identity.claims, (tx) => myNotifications(tx, offset, 30));
    return ok(requestId, {
      notifications: page.notifications,
      has_more: page.has_more,
      next_cursor: page.next_offset === null ? null : encodeCursor(page.next_offset),
      unread: page.unread
    });
  });
}
