// Extensions (M4.2). Thin wrappers; the deadlines, locks and payment rules live in the app.* functions.
import type postgres from "postgres";
import type { PaymentOrderRow } from "./domain";

type Tx = postgres.TransactionSql;
type Json = Record<string, unknown>;

async function callJson<T = Json>(query: postgres.PendingQuery<postgres.Row[]>): Promise<T> {
  const rows = await query;
  return rows[0]?.result as T;
}

export function requestExtension(tx: Tx, bookingId: string, additionalMinutes: number, expectedVersion: number, requestId: string | null = null) {
  return callJson(tx`
    select app.request_extension(${bookingId}::uuid, ${additionalMinutes}::integer, ${expectedVersion}::integer, ${requestId}::uuid) as result`);
}

export function decideExtension(
  tx: Tx,
  extensionId: string,
  input: { decision: "APPROVE" | "DECLINE"; reason?: string | undefined; expected_version: number },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.decide_extension(${extensionId}::uuid, ${input.decision}, ${input.reason ?? null}, ${input.expected_version}::integer,
                                ${requestId}::uuid) as result`);
}

export function holdExtension(tx: Tx, extensionId: string, acceptedPricePaise: number, expectedVersion: number, requestId: string | null = null) {
  return callJson(tx`
    select app.hold_extension(${extensionId}::uuid, ${acceptedPricePaise}::bigint, ${expectedVersion}::integer, ${requestId}::uuid) as result`);
}

export function beginExtensionCheckout(
  tx: Tx,
  input: { extension_id: string; expected_version: number; provider: string; environment: string },
  requestId: string | null = null
) {
  return callJson<PaymentOrderRow & { created: boolean; extension_status: string; hold_expires_at: string }>(tx`
    select app.begin_extension_checkout(${input.extension_id}::uuid, ${input.expected_version}::integer, ${input.provider},
                                        ${input.environment}, ${requestId}::uuid) as result`);
}

export function cancelExtension(tx: Tx, extensionId: string, requestId: string | null = null) {
  return callJson(tx`select app.cancel_extension(${extensionId}::uuid, ${requestId}::uuid) as result`);
}

export function staffExtensionRequests(tx: Tx, venueId: string) {
  return callJson<Json[]>(tx`select app.staff_extension_requests(${venueId}::uuid) as result`);
}
