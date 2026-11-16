import { adminFinanceOverview } from "@simply-sit/db";
import { authedRoute } from "../../../../../lib/route";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/finance - A05 overview for finance/superadmin with TOTP: ledger balances, refunds needing
// attention, reconciliation runs, partner payables, payout batches and fee versions.
export function GET(request: Request) {
  return authedRoute(request, {}, ({ tx }) => adminFinanceOverview(tx));
}
