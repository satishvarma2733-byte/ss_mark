// Customer-facing view of a stored price snapshot. The immutable snapshot keeps the commission allocation and fee
// configuration (docs/02 s.4) for finance; customers and anonymous callers see only what they pay (review F7).
const INTERNAL_PRICE_FIELDS = ["commission_bps", "platform_fixed_paise", "rounding_rule"] as const;

export function customerPrice<T>(snapshot: T): T {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot;
  const copy = { ...(snapshot as Record<string, unknown>) };
  for (const field of INTERNAL_PRICE_FIELDS) delete copy[field];
  return copy as T;
}
