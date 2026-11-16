import { quoteRequestSchema } from "@simply-sit/contracts";
import { asUser, createQuote, getDb } from "@simply-sit/db";
import { assertSameOrigin, handle, ok, parseBody } from "../../../../lib/api";
import { requireUser } from "../../../../lib/auth/identity";
import { assertSupportedClient } from "../../../../lib/service-status";
import { customerPrice } from "../../../../lib/price";

export const dynamic = "force-dynamic";

// POST /api/v1/quotes - server pricing only; advisory, no inventory commitment (docs/07 s.3).
export function POST(request: Request) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    assertSameOrigin(request, identity.via);
    assertSupportedClient(request);
    const body = await parseBody(request, quoteRequestSchema);
    const quote = await asUser(getDb(), identity.claims, (tx) => createQuote(tx, body));
    return ok(requestId, { ...quote, price_snapshot: customerPrice(quote.price_snapshot) }, 201);
  });
}
