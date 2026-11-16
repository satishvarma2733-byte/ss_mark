import { statementQuerySchema } from "@simply-sit/contracts";
import { asUser, getDb, partnerStatement } from "@simply-sit/db";
import { handle, ok, parseQuery, parseUuid } from "../../../../../../../lib/api";
import { requireUser } from "../../../../../../../lib/auth/identity";
import { statementCsv } from "../../../../../../../lib/statement";

export const dynamic = "force-dynamic";

// GET /api/v1/partner/venues/{id}/statement?from&to&format=json|csv - P07 statement for the venue's manager/owner with
// TOTP: earnings, partner-charged refund adjustments, this venue's share of payouts, unresolved totals flagged.
// Staff get 403; other venues 404. The CSV neutralises spreadsheet formulas.
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const identity = await requireUser();
    const venueId = parseUuid((await context.params).id);
    const query = parseQuery(request, statementQuerySchema);
    const statement = await asUser(getDb(), identity.claims, (tx) => partnerStatement(tx, venueId, query.from, query.to));
    if (query.format === "json") return ok(requestId, statement);
    return new Response(statementCsv(statement), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="simply-sit-statement-${query.from}-to-${query.to}.csv"`,
        "cache-control": "no-store",
        "x-request-id": requestId
      }
    });
  });
}
