// Server-side pricing rules for a single table booking, driven by a versioned policy (see policy.ts).
// Server-only in intent: clients may display these rules but must never compute a payable total for checkout.
import { getPolicy, type BookingPolicy } from "./policy";

export type DurationProblem = "TOO_SHORT" | "TOO_LONG" | "NOT_IN_INCREMENTS" | "NOT_A_WHOLE_NUMBER";

export function checkDuration(
  minutes: number,
  policy: BookingPolicy = getPolicy()
): { ok: true } | { ok: false; problem: DurationProblem } {
  if (!Number.isInteger(minutes)) return { ok: false, problem: "NOT_A_WHOLE_NUMBER" };
  if (minutes < policy.minimumMinutes) return { ok: false, problem: "TOO_SHORT" };
  if (minutes > policy.maximumMinutes) return { ok: false, problem: "TOO_LONG" };
  if (minutes % policy.incrementMinutes !== 0) return { ok: false, problem: "NOT_IN_INCREMENTS" };
  return { ok: true };
}

export type TableQuote = {
  blocks: number;
  seatingPaise: number;
  feesPaise: number;
  totalPaise: number;
  pricingBasis: "per 30 minutes, one table";
  policyVersion: string;
};

// Integer arithmetic only. feesPaise is 0 because no commission or tax rate is approved (see docs/00 section 4).
export function quoteTable(input: { pricePerBlockPaise: number; durationMinutes: number; policyVersion?: string }): TableQuote {
  const policy = getPolicy(input.policyVersion);
  const check = checkDuration(input.durationMinutes, policy);
  if (!check.ok) throw new Error(`Invalid duration: ${check.problem}`);
  if (!Number.isInteger(input.pricePerBlockPaise) || input.pricePerBlockPaise < 0) {
    throw new Error("Price must be a non-negative integer number of paise");
  }
  const blocks = input.durationMinutes / policy.incrementMinutes;
  const seatingPaise = blocks * input.pricePerBlockPaise;
  const feesPaise = 0;
  return {
    blocks,
    seatingPaise,
    feesPaise,
    totalPaise: seatingPaise + feesPaise,
    pricingBasis: "per 30 minutes, one table",
    policyVersion: policy.version
  };
}
