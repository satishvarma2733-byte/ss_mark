import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import {
  assertLocalDatabase, createPaymentGateway, createProviders, EnvValidationError, findSecretLikePublicVars, loadArrivalSecret, loadMockGatewayConfig,
  loadServerEnv, MockEmailProvider, MockGateway, MockMapsProvider
} from "./index";

const gatewayConfig = {
  keyId: "mock_key_0123456789abcdef",
  keySecret: "k".repeat(40),
  webhookSecret: "w".repeat(40),
  appUrl: "http://localhost:3000"
};
// Signature and URL helpers need no database; the stub fails loudly if one is touched.
const noDatabase = new Proxy({}, { get: () => { throw new Error("database not expected"); } }) as unknown as postgres.Sql;

describe("MockGateway signatures and URLs", () => {
  const gateway = new MockGateway(noDatabase, gatewayConfig);

  it("verifies the checkout callback signature and rejects tampering", () => {
    const signature = gateway.checkoutSignature("order_mock_a", "pay_mock_b");
    expect(gateway.verifyCheckoutSignature({ providerOrderId: "order_mock_a", providerPaymentId: "pay_mock_b", signature })).toBe(true);
    expect(gateway.verifyCheckoutSignature({ providerOrderId: "order_mock_a", providerPaymentId: "pay_mock_c", signature })).toBe(false);
    expect(gateway.verifyCheckoutSignature({ providerOrderId: "order_mock_a", providerPaymentId: "pay_mock_b", signature: "00" })).toBe(false);
  });

  it("verifies webhook signatures over the exact raw body", () => {
    const body = JSON.stringify({ id: "evt_1", event: "payment.captured" });
    const signature = gateway.webhookSignature(body);
    expect(gateway.verifyWebhookSignature(body, signature)).toBe(true);
    expect(gateway.verifyWebhookSignature(`${body} `, signature)).toBe(false);
    expect(gateway.verifyWebhookSignature(body, null)).toBe(false);
    const other = new MockGateway(noDatabase, { ...gatewayConfig, webhookSecret: "x".repeat(40) });
    expect(other.verifyWebhookSignature(body, signature)).toBe(false);
  });

  it("builds checkout URLs on the app origin and only allowlisted return targets", () => {
    const url = new URL(gateway.checkoutUrl({ providerOrderId: "order_mock_a", paymentOrderId: "p1", returnTo: "native-dev" }));
    expect(url.origin).toBe("http://localhost:3000");
    expect(url.pathname).toBe("/mock-gateway/checkout/order_mock_a");
    expect(gateway.returnUrl("web")).toBe("http://localhost:3000/payment/return");
    expect(gateway.returnUrl("native-dev")).toBe("simplysit-dev://payment-return");
  });

  it("is enabled only by an explicit local opt-in with an explicit development/test APP_ENV", () => {
    const local = {
      MOCK_GATEWAY_ENABLED: "true", APP_ENV: "development", DATABASE_URL: "postgresql://u:p@127.0.0.1:54422/postgres",
      MOCK_GATEWAY_KEY_ID: gatewayConfig.keyId, MOCK_GATEWAY_KEY_SECRET: gatewayConfig.keySecret,
      MOCK_GATEWAY_WEBHOOK_SECRET: gatewayConfig.webhookSecret, NEXT_PUBLIC_APP_URL: gatewayConfig.appUrl
    };
    const env = { APP_ENV: "development" as const, PAYMENT_PROVIDER: "mock" as const };
    expect(createPaymentGateway(noDatabase, env, local)).toBeInstanceOf(MockGateway);
    expect(() => createPaymentGateway(noDatabase, env, { ...local, MOCK_GATEWAY_ENABLED: undefined })).toThrow("MOCK_GATEWAY_ENABLED");
    expect(() => createPaymentGateway(noDatabase, env, { ...local, APP_ENV: undefined })).toThrow("APP_ENV");
    expect(() => createPaymentGateway(noDatabase, { ...env, APP_ENV: "production" }, { ...local, APP_ENV: "production" })).toThrow();
    expect(() => createPaymentGateway(noDatabase, env, { ...local, DATABASE_URL: "postgresql://u:p@db.example.com:5432/postgres" })).toThrow("LOCAL");
  });

  it("refuses short secrets and non-local databases", () => {
    expect(() => new MockGateway(noDatabase, { ...gatewayConfig, keySecret: "short" })).toThrow("at least 32");
    expect(() => assertLocalDatabase("postgresql://u:p@db.example.com:5432/postgres")).toThrow("LOCAL");
    expect(() => assertLocalDatabase("postgresql://u:p@127.0.0.1:54422/postgres")).not.toThrow();
  });
});

describe("server secrets", () => {
  it("loads the mock gateway config and arrival secret, failing closed without echoing values", () => {
    const source = {
      MOCK_GATEWAY_KEY_ID: "mock_key_0123456789abcdef",
      MOCK_GATEWAY_KEY_SECRET: "s".repeat(43),
      MOCK_GATEWAY_WEBHOOK_SECRET: "t".repeat(43),
      NEXT_PUBLIC_APP_URL: "http://localhost:3000/",
      ARRIVAL_CODE_SECRET: "a".repeat(43)
    };
    expect(loadMockGatewayConfig(source)).toMatchObject({ keyId: source.MOCK_GATEWAY_KEY_ID, appUrl: "http://localhost:3000" });
    expect(loadArrivalSecret(source)).toBe(source.ARRIVAL_CODE_SECRET);
    try {
      loadMockGatewayConfig({ ...source, MOCK_GATEWAY_KEY_SECRET: "shortValue1234" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as Error).message).not.toContain("shortValue1234");
    }
    expect(() => loadArrivalSecret({})).toThrow(EnvValidationError);
  });
});

describe("MockEmailProvider", () => {
  it("records a repeated logical message once and never delivers", async () => {
    const email = new MockEmailProvider();
    const message = { to: "demo@example.invalid", template: "booking-confirmed", idempotencyKey: "booking_1:confirmed" };
    const a = await email.send(message);
    const b = await email.send(message);
    expect(b).toEqual(a);
    expect(a.delivered).toBe(false);
    expect(email.outbox).toHaveLength(1);
  });
});

describe("MockMapsProvider", () => {
  it("suggests only synthetic localities and returns nothing for an empty query", async () => {
    const maps = new MockMapsProvider();
    const results = await maps.searchAreas("locality a");
    expect(results).toEqual([{ label: "Demo locality A (fictional)", isSynthetic: true }]);
    expect(await maps.searchAreas("   ")).toEqual([]);
  });
});

describe("server environment", () => {
  it("defaults every provider to mock when unset", () => {
    expect(loadServerEnv({})).toEqual({
      APP_ENV: "development",
      APP_MODE: "mock",
      PAYMENT_PROVIDER: "mock",
      EMAIL_PROVIDER: "mock",
      MAPS_PROVIDER: "mock"
    });
  });

  it("fails closed when a live mode or provider is requested", () => {
    expect(() => loadServerEnv({ APP_MODE: "live" })).toThrow(EnvValidationError);
    expect(() => loadServerEnv({ PAYMENT_PROVIDER: "razorpay" })).toThrow("PAYMENT_PROVIDER");
  });

  it("rejects secrets in client-bundled public variables without echoing the value", () => {
    const source = { NEXT_PUBLIC_SUPABASE_SECRET_KEY: "x", EXPO_PUBLIC_API_URL: "sb_secret_abcdef", NEXT_PUBLIC_APP_URL: "http://localhost:3000" };
    expect(findSecretLikePublicVars(source)).toEqual(["EXPO_PUBLIC_API_URL", "NEXT_PUBLIC_SUPABASE_SECRET_KEY"]);
    try {
      loadServerEnv(source);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("sb_secret_abcdef");
    }
  });

  it("builds only mock providers", () => {
    const providers = createProviders(loadServerEnv({}));
    expect([providers.email.mode, providers.maps.mode]).toEqual(["mock", "mock"]);
  });
});
