// Server-only configuration. Import from route handlers, server components and instrumentation.ts only.
import { getDb } from "@simply-sit/db";
import type { PaymentServices } from "@simply-sit/payments";
import {
  createPaymentGateway, createProviders, loadArrivalSecret, loadServerEnv, type MockGateway, type Providers, type ServerEnv
} from "@simply-sit/providers";

let env: ServerEnv | undefined;
let providers: Providers | undefined;
let payments: (PaymentServices & { gateway: MockGateway }) | undefined;

export function getServerEnv(): ServerEnv {
  env ??= loadServerEnv(process.env);
  return env;
}

export function getProviders(): Providers {
  providers ??= createProviders(getServerEnv());
  return providers;
}

// Payment gateway (local mock only) and the arrival-code secret. Fails closed when either is not configured.
export function getPaymentServices(): PaymentServices & { gateway: MockGateway } {
  if (!payments) {
    const sql = getDb();
    payments = { sql, gateway: createPaymentGateway(sql, getServerEnv(), process.env), arrivalSecret: loadArrivalSecret(process.env) };
  }
  return payments;
}

// Checked at startup without opening a database connection.
export function validatePaymentConfig() {
  loadArrivalSecret(process.env);
  createPaymentGateway({} as never, getServerEnv(), process.env);
}
