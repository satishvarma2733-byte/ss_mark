import { describe, expect, it } from "vitest";
import { ApiError, createSimplySitClient } from "./index";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("api client", () => {
  it("parses a venue search and encodes filters as comma lists on the versioned path", async () => {
    const calls: string[] = [];
    const client = createSimplySitClient({
      baseUrl: "http://example.test/",
      fetchImpl: async (input) => {
        calls.push(input);
        return jsonResponse(200, { data: { venues: [], total: 0, next_cursor: null, searched_at: "2026-10-27T00:00:00Z", area: null }, request_id: "r" });
      }
    });
    const result = await client.searchVenues({ area: "koramangala", environment_tags: ["QUIET", "OUTDOOR"], party_size: 2 });
    expect(result.venues).toEqual([]);
    expect(calls).toEqual(["http://example.test/api/v1/venues?area=koramangala&environment_tags=QUIET%2COUTDOOR&party_size=2"]);
  });

  it("sends the hold's idempotency key and reports offline as a retryable error", async () => {
    const headers: Record<string, string>[] = [];
    const client = createSimplySitClient({
      baseUrl: "http://example.test",
      getAccessToken: async () => "t",
      fetchImpl: async (_input, init) => {
        headers.push(init?.headers as Record<string, string>);
        throw new TypeError("Network request failed");
      }
    });
    const quote = { quote_id: "q", policy_hash: "sha256:x", price_snapshot: { total_paise: 100 } } as never;
    const error = await client.createHold(quote, "11111111-1111-4111-8111-111111111111").catch((e: unknown) => e);
    expect(headers[0]!["idempotency-key"]).toBe("11111111-1111-4111-8111-111111111111");
    expect(error).toMatchObject({ code: "NETWORK", retryable: true });
  });

  it("identifies a native client by version on every call and reads the service status", async () => {
    const headers: Record<string, string>[] = [];
    const client = createSimplySitClient({
      baseUrl: "http://example.test",
      clientVersion: "android/0.1.0",
      fetchImpl: async (_input, init) => {
        headers.push(init?.headers as Record<string, string>);
        return jsonResponse(200, { data: { bookings_open: false, extensions_open: true, native_min_version: "0.2.0" }, request_id: "r" });
      }
    });
    expect(await client.getServiceStatus()).toEqual({ bookings_open: false, extensions_open: true, native_min_version: "0.2.0" });
    expect(headers[0]!["x-simply-sit-client"]).toBe("android/0.1.0");
  });

  it("surfaces the docs/07 error envelope as an ApiError", async () => {
    const client = createSimplySitClient({
      baseUrl: "http://example.test",
      fetchImpl: async () =>
        jsonResponse(503, {
          error: { code: "DEPENDENCY_UNAVAILABLE", message: "Try again shortly.", retryable: true, field_errors: {} },
          request_id: "req_9"
        })
    });
    const error = await client.getHealth().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).retryable).toBe(true);
    expect((error as ApiError).requestId).toBe("req_9");
  });

  it("sends the bearer token only on authenticated calls and refuses to call without one", async () => {
    const seen: (string | undefined)[] = [];
    const me = {
      profile_id: "8f2b7c2e-1d4a-4c3b-9e7f-2a1b3c4d5e6f", display_name: null, status: "ACTIVE", terms_required: false,
      current_terms_version: "t", current_privacy_version: "p", aal: "aal1", mfa_required_for_portal: false,
      venue_memberships: [], platform_roles: [], version: 1
    };
    const client = createSimplySitClient({
      baseUrl: "http://example.test",
      getAccessToken: async () => "token-123",
      fetchImpl: async (_input, init) => {
        seen.push((init?.headers as Record<string, string>).authorization);
        return jsonResponse(200, { data: me, request_id: "r1" });
      }
    });
    await client.getMe();
    expect(seen).toEqual(["Bearer token-123"]);

    const anonymous = createSimplySitClient({ baseUrl: "http://example.test", getAccessToken: async () => null, fetchImpl: async () => jsonResponse(200, {}) });
    await expect(anonymous.getMe()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("rejects a 200 response that does not match the contract", async () => {
    const client = createSimplySitClient({
      baseUrl: "http://example.test",
      fetchImpl: async () => jsonResponse(200, { data: { venues: "not-a-list" }, request_id: "r" })
    });
    await expect(client.searchVenues()).rejects.toThrow();
  });
});
