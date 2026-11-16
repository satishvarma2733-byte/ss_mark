// Fixed-window limiter for sign-in abuse controls, in addition to Supabase Auth's own limits.
// Per-process memory only: a shared store is required before running more than one web instance (recorded in HANDOFF).
type Window = { count: number; resetAt: number };

export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now
  ) {}

  attempt(key: string): boolean {
    const now = this.now();
    if (this.windows.size > 10_000) {
      for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
    }
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    return true;
  }
}

export const otpRequestLimiter = new RateLimiter(5, 15 * 60_000);
export const otpVerifyLimiter = new RateLimiter(10, 15 * 60_000);

export function clientKey(request: Request, extra: string): string {
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "local";
  return `${ip}|${extra.toLowerCase()}`;
}

// Payment status checks call the provider; a signed-in customer may not loop them (review F5). Per user and order.
export const paymentVerifyLimiter = new RateLimiter(30, 60_000);
