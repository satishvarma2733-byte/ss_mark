import { notificationPreferencesInputSchema, type NotificationPreferencesInput } from "@simply-sit/contracts";
import { myNotificationPreferences, setNotificationPreferences } from "@simply-sit/db";
import { authedRoute } from "../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET /api/v1/me/notification-preferences - the caller's optional notification choices (defaults when never saved).
export function GET(request: Request) {
  return authedRoute(request, {}, ({ tx }) => myNotificationPreferences(tx));
}

// PUT /api/v1/me/notification-preferences - saves both choices. Essential booking and security messages are not affected.
export function PUT(request: Request) {
  return authedRoute<NotificationPreferencesInput>(request, { schema: notificationPreferencesInputSchema }, ({ tx, body }) => setNotificationPreferences(tx, body));
}
