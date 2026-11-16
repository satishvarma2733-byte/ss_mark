import { adminTicketQueue } from "@simply-sit/db";
import { authedRoute } from "../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/support-tickets?status= - triage queue; confidential tickets the caller may not open are counted only.
export function GET(request: Request) {
  return authedRoute(request, {}, ({ tx }) => adminTicketQueue(tx, new URL(request.url).searchParams.get("status") ?? "OPEN"));
}
