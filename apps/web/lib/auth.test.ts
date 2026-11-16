import { describe, expect, it } from "vitest";
import { allowedOrigins, assertSameOrigin, safeRedirectPath } from "./api";
import { decodeClaims } from "./auth/claims";
import { hasSupabaseSessionCookie } from "./auth/cookies";
import { RateLimiter } from "./rate-limit";

const token = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

describe("safeRedirectPath (validated sign-in return paths)", () => {
  it("keeps internal relative paths with their query", () => {
    expect(safeRedirectPath("/account")).toBe("/account");
    expect(safeRedirectPath("/venues/demo-cafe-koramangala?x=1")).toBe("/venues/demo-cafe-koramangala?x=1");
  });

  it("rejects external, protocol-relative, backslash and header-injection destinations", () => {
    for (const value of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/a\r\nSet-Cookie: x", "", null, undefined]) {
      expect(safeRedirectPath(value)).toBe("/");
    }
  });
});

describe("origin check for cookie-authenticated writes", () => {
  it("accepts the app origin, rejects others and missing Origin, and exempts native bearer calls", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    process.env.APP_ALLOWED_ORIGINS = "http://localhost:3100";
    expect(allowedOrigins()).toEqual(["http://localhost:3000", "http://localhost:3100"]);
    const req = (origin?: string) => new Request("http://localhost:3000/api/v1/me/terms", { method: "POST", headers: origin ? { origin } : {} });
    expect(() => assertSameOrigin(req("http://localhost:3000"), "cookie")).not.toThrow();
    expect(() => assertSameOrigin(req("https://evil.example"), "cookie")).toThrow("FORBIDDEN");
    expect(() => assertSameOrigin(req(), "cookie")).toThrow("FORBIDDEN");
    expect(() => assertSameOrigin(req(), "bearer")).not.toThrow();
  });
});

describe("decodeClaims", () => {
  it("keeps only the fields the database uses and defaults to aal1", () => {
    const claims = decodeClaims(token({ sub: "u1", role: "authenticated", aal: "aal2", amr: [{ method: "otp", timestamp: 5 }, { bad: 1 }], email: "x@example.test" }));
    expect(claims).toEqual({ sub: "u1", role: "authenticated", aal: "aal2", amr: [{ method: "otp", timestamp: 5 }] });
    expect(decodeClaims(token({ sub: "u1", role: "authenticated" })).aal).toBe("aal1");
  });

  it("rejects anon/service tokens and garbage", () => {
    expect(() => decodeClaims(token({ sub: "u1", role: "service_role" }))).toThrow("AUTH_REQUIRED");
    expect(() => decodeClaims(token({ role: "authenticated" }))).toThrow("AUTH_REQUIRED");
    expect(() => decodeClaims("not-a-jwt")).toThrow("AUTH_REQUIRED");
  });
});

describe("session cookie detection", () => {
  it("recognises Supabase auth cookies including chunked ones", () => {
    expect(hasSupabaseSessionCookie(["sb-localhost-auth-token"])).toBe(true);
    expect(hasSupabaseSessionCookie(["sb-127-auth-token.0", "other"])).toBe(true);
    expect(hasSupabaseSessionCookie(["theme", "sb-other"])).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("allows the limit within a window, then blocks until the window resets", () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1000, () => now);
    expect([limiter.attempt("k"), limiter.attempt("k"), limiter.attempt("k")]).toEqual([true, true, false]);
    expect(limiter.attempt("other")).toBe(true);
    now = 1000;
    expect(limiter.attempt("k")).toBe(true);
  });
});
