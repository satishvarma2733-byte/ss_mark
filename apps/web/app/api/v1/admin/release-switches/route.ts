import { releaseSwitchChangeSchema } from "@simply-sit/contracts";
import { adminReleaseSwitches, adminSetReleaseSwitch } from "@simply-sit/db";
import { authedRoute } from "../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/release-switches - every platform administrator (TOTP) sees the switches and who changed them.
export function GET(request: Request) {
  return authedRoute(request, {}, async ({ tx }) => adminReleaseSwitches(tx));
}

// POST /api/v1/admin/release-switches {key,is_open,reason,expected_version} - superadmin opens or closes new bookings
// and extensions; finance may also pause or release payouts. Audited with the reason.
export function POST(request: Request) {
  return authedRoute(request, { schema: releaseSwitchChangeSchema, idempotencyRoute: "POST /admin/release-switches" },
    async ({ tx, body, requestId }) => adminSetReleaseSwitch(tx, body, requestId));
}
