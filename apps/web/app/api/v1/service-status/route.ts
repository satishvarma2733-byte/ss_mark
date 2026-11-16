import { handle, ok } from "../../../../lib/api";
import { loadServiceStatus } from "../../../../lib/service-status";

export const dynamic = "force-dynamic";

// GET /api/v1/service-status - public: whether new bookings and extensions are open, and the oldest native app version
// that may start them (M6). Advisory for clients; the database enforces the switches.
export function GET() {
  return handle(async (requestId) => ok(requestId, await loadServiceStatus()));
}
