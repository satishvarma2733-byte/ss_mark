// SERVER-ONLY package. Mobile and client components must not import it (enforced by eslint.config.mjs for apps/mobile).
import type postgres from "postgres";
import { MockEmailProvider, MockMapsProvider } from "./mock";
import { loadMockGatewayConfig, type ServerEnv } from "./env";
import { assertLocalDatabase, MockGateway } from "./mock-gateway";
import type { Providers } from "./types";

export * from "./types";
export * from "./mock";
export * from "./env";
export * from "./gateway";
export * from "./mock-gateway";

// Builds providers from validated configuration. Only mock adapters exist, and env validation already rejects anything else.
export function createProviders(env: Pick<ServerEnv, "PAYMENT_PROVIDER" | "EMAIL_PROVIDER" | "MAPS_PROVIDER">): Providers {
  if (env.PAYMENT_PROVIDER !== "mock" || env.EMAIL_PROVIDER !== "mock" || env.MAPS_PROVIDER !== "mock") {
    throw new Error("Only mock providers are available");
  }
  return { email: new MockEmailProvider(), maps: new MockMapsProvider() };
}

// The payment gateway for this environment. Only the local mock exists; it refuses production and non-local databases.
export function createPaymentGateway(
  sql: postgres.Sql,
  env: Pick<ServerEnv, "APP_ENV" | "PAYMENT_PROVIDER">,
  source: Record<string, string | undefined> = process.env
): MockGateway {
  if (env.PAYMENT_PROVIDER !== "mock") throw new Error("Only the mock payment gateway is available");
  // Explicit local opt-in (review F15): never on by default, and only with an explicitly set development/test APP_ENV.
  if (source.MOCK_GATEWAY_ENABLED !== "true") {
    throw new Error("The mock payment gateway is disabled: set MOCK_GATEWAY_ENABLED=true (LOCAL only; pnpm env:local does this)");
  }
  if (source.APP_ENV !== "development" && source.APP_ENV !== "test") {
    throw new Error("The mock payment gateway needs APP_ENV explicitly set to development or test");
  }
  assertLocalDatabase(source.DATABASE_URL);
  return new MockGateway(sql, loadMockGatewayConfig(source));
}
