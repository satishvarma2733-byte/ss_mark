import { adminReviewQueue } from "@simply-sit/db";
import { authedRoute } from "../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/reviews?status= - moderation queue (support/superadmin with TOTP).
export function GET(request: Request) {
  return authedRoute(request, {}, ({ tx }) => adminReviewQueue(tx, new URL(request.url).searchParams.get("status") ?? "PENDING"));
}
