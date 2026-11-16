import { reconciliationRequestSchema } from "@simply-sit/contracts";
import { adminFinanceOverview, DomainError } from "@simply-sit/db";
import { RetryLaterError, runReconciliation } from "@simply-sit/payments";
import { assertSameOrigin, handle, ok, parseBody } from "../../../../../lib/api";
import { requireUser } from "../../../../../lib/auth/identity";
import { authedRoute } from "../../../../../lib/route";
import { getPaymentServices } from "../../../../../lib/server-env";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/reconciliation - the latest runs (finance + TOTP).
export function GET(request: Request) {
  return authedRoute(request, {}, async ({ tx }) => ((await adminFinanceOverview(tx)) as { reconciliation: unknown }).reconciliation);
}

// POST /api/v1/admin/reconciliation {from, to} - compares the provider's captures and refunds for the period (at most
// 31 days) with local records and the ledger. The provider is queried here on the server, never by the client. Safe to
// repeat; a mismatch blocks payout approval for the period until a later run matches.
export function POST(request: Request) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    assertSameOrigin(request, identity.via);
    const body = await parseBody(request, reconciliationRequestSchema);
    // runReconciliation starts the run as this user, so permission and TOTP are checked before the provider is called.
    try {
      return ok(requestId, await runReconciliation(getPaymentServices(), identity.claims, body, requestId), 201);
    } catch (error) {
      if (error instanceof RetryLaterError) throw new DomainError("PROVIDER_UNAVAILABLE");
      throw error;
    }
  });
}
