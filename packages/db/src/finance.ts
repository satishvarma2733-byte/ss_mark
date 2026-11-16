// Finance and payouts (M4.4). Thin wrappers; earning, refund, reconciliation and payout rules live in the app.*
// functions. The reconciliation and earnings functions are worker-only.
import type postgres from "postgres";
import type { PartnerStatement } from "@simply-sit/contracts";

type Tx = postgres.TransactionSql;
type Json = Record<string, unknown>;

async function callJson<T = Json>(query: postgres.PendingQuery<postgres.Row[]>): Promise<T> {
  const rows = await query;
  return rows[0]?.result as T;
}

export type ReconciliationRun = {
  run_id: string; provider: string; environment: string; period_from: string; period_to: string;
  status: "RUNNING" | "MATCHED" | "MISMATCH" | "FAILED"; exception_count: number; error_code: string | null;
  provider_captures: number | null; provider_captured_paise: number | null; local_captures: number | null;
  local_captured_paise: number | null; provider_refunds: number | null; provider_refunded_paise: number | null;
  local_refunds: number | null; local_refunded_paise: number | null; started_at: string; completed_at: string | null;
};

export type ReconciliationException = {
  kind: "MISSING_LOCALLY" | "MISSING_AT_PROVIDER" | "AMOUNT_MISMATCH" | "STATE_MISMATCH" | "LEDGER_MISSING";
  object_type: "PAYMENT" | "REFUND"; provider_ref: string | null; local_id: string | null; booking_id: string | null;
  public_ref: string | null; provider_amount_paise: number | null; local_amount_paise: number | null;
};

export type ProviderCaptureRecord = { provider_payment_id: string; amount_paise: number; captured_at: string };
export type ProviderRefundRecord = {
  provider_refund_id: string; provider_payment_id: string; amount_paise: number; state: string; created_at: string;
};

export async function recognizeEarnings(tx: Tx, limit = 100): Promise<number> {
  const [row] = await tx`select app.recognize_earnings(${limit}::integer, null) as count`;
  return Number(row?.count ?? 0);
}

export function adminRefundOptions(tx: Tx, bookingId: string) {
  return callJson(tx`select app.admin_refund_options(${bookingId}::uuid) as result`);
}

export function adminRefund(
  tx: Tx,
  input: { booking_id: string; amount_paise: number; charge_to?: "PARTNER" | "PLATFORM" | undefined; reason: string },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.admin_refund(${input.booking_id}::uuid, ${input.amount_paise}::bigint, ${input.charge_to ?? null}, ${input.reason},
                            ${requestId}::uuid) as result`);
}

// Retries a FAILED refund as a new provider operation (same liability: no new journal, no new charge).
export function adminRetryRefund(tx: Tx, refundId: string, reason: string, requestId: string | null = null) {
  return callJson(tx`select app.admin_retry_refund(${refundId}::uuid, ${reason}, ${requestId}::uuid) as result`);
}

export function adminCreateFeeConfig(
  tx: Tx,
  input: { config_version: string; commission_bps: number; platform_fixed_paise: number; customer_fee_paise: number; effective_from: string },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.admin_create_fee_config(${input.config_version}, ${input.commission_bps}::integer, ${input.platform_fixed_paise}::bigint,
                                       ${input.customer_fee_paise}::bigint, ${input.effective_from}::timestamptz,
                                       ${requestId}::uuid) as result`);
}

export function adminApproveFeeConfig(tx: Tx, feeConfigId: string, expectedVersion: number, requestId: string | null = null) {
  return callJson(tx`
    select app.admin_approve_fee_config(${feeConfigId}::uuid, ${expectedVersion}::integer, ${requestId}::uuid) as result`);
}

export function beginReconciliation(
  tx: Tx,
  input: { from: string; to: string; provider: string; environment: string },
  requestId: string | null = null
) {
  return callJson<ReconciliationRun>(tx`
    select app.begin_reconciliation(${input.from}::timestamptz, ${input.to}::timestamptz, ${input.provider}, ${input.environment},
                                    ${requestId}::uuid) as result`);
}

export function completeReconciliation(tx: Tx, runId: string, captures: ProviderCaptureRecord[], refunds: ProviderRefundRecord[]) {
  return callJson<ReconciliationRun>(tx`
    select app.complete_reconciliation(${runId}::uuid, ${tx.json(captures)}::jsonb, ${tx.json(refunds)}::jsonb) as result`);
}

export function failReconciliation(tx: Tx, runId: string, errorCode: string) {
  return callJson<ReconciliationRun>(tx`select app.fail_reconciliation(${runId}::uuid, ${errorCode}) as result`);
}

export function adminReconciliationRun(tx: Tx, runId: string) {
  return callJson<ReconciliationRun & { exceptions: ReconciliationException[] }>(tx`select app.admin_reconciliation_run(${runId}::uuid) as result`);
}

export function createPayoutBatch(tx: Tx, partnerId: string, requestId: string | null = null) {
  return callJson(tx`select app.create_payout_batch(${partnerId}::uuid, ${requestId}::uuid) as result`);
}

export function approvePayoutBatch(tx: Tx, batchId: string, expectedVersion: number, requestId: string | null = null) {
  return callJson(tx`select app.approve_payout_batch(${batchId}::uuid, ${expectedVersion}::integer, ${requestId}::uuid) as result`);
}

export function markPayoutBatch(
  tx: Tx,
  batchId: string,
  input: { status: "PROCESSING" | "PAID" | "FAILED" | "CANCELLED"; expected_version: number; reference?: string | undefined; reason?: string | undefined },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.mark_payout_batch(${batchId}::uuid, ${input.status}, ${input.expected_version}::integer, ${input.reference ?? null},
                                 ${input.reason ?? null}, ${requestId}::uuid) as result`);
}

export function adminFinanceOverview(tx: Tx) {
  return callJson(tx`select app.admin_finance_overview() as result`);
}

export function partnerStatement(tx: Tx, venueId: string, from: string, to: string) {
  return callJson<PartnerStatement>(tx`select app.partner_statement(${venueId}::uuid, ${from}::date, ${to}::date) as result`);
}
