// Worker entry point: validated configuration, PostgreSQL outbox loop, graceful stop on SIGINT/SIGTERM.
// A hard crash (kill -9) is recovered by lease expiry: another worker re-leases the job (docs/07 s.8).
import { hostname } from "node:os";
import { createDb } from "@simply-sit/db";
import type { PaymentServices } from "@simply-sit/payments";
import { createPaymentGateway, createProviders, loadArrivalSecret, loadServerEnv, type ServerEnv } from "@simply-sit/providers";
import { createOps, tick, type WorkerState } from "./loop";

let env: ServerEnv;
try {
  env = loadServerEnv(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Invalid environment configuration:\n  - DATABASE_URL: required (run pnpm env:local for the local stack)");
  process.exit(1);
}

const INTERVAL_MS = Math.max(250, Number(process.env.WORKER_TICK_MS ?? 5000));
const config = {
  batchSize: Math.min(50, Math.max(1, Number(process.env.WORKER_BATCH_SIZE ?? 10))),
  leaseSeconds: Math.min(900, Math.max(5, Number(process.env.WORKER_LEASE_SECONDS ?? 60)))
};
const state: WorkerState = {
  workerId: process.env.WORKER_ID ?? `${hostname()}-${process.pid}`,
  startedAt: new Date(),
  ticks: 0,
  completed: 0,
  failed: 0,
  expired: 0,
  reconciled: 0
};

const sql = createDb(databaseUrl, { max: 3 });
const providers = createProviders(env);
let payments: PaymentServices;
try {
  payments = { sql, gateway: createPaymentGateway(sql, env, process.env), arrivalSecret: loadArrivalSecret(process.env) };
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
const ops = createOps(sql, providers.email, state.workerId, payments);
let stopping = false;

console.info(
  `[worker] started id=${state.workerId} env=${env.APP_ENV} mode=${env.APP_MODE} providers=${env.PAYMENT_PROVIDER}(mock gateway, TEST)/${env.EMAIL_PROVIDER}/${env.MAPS_PROVIDER} interval_ms=${INTERVAL_MS} lease_s=${config.leaseSeconds} (SYNTHETIC)`
);

async function loop() {
  while (!stopping) {
    const started = Date.now();
    await tick(sql, ops, state, config, payments);
    console.info(
      `[worker] tick=${state.ticks} completed=${state.completed} failed=${state.failed} holds_expired=${state.expired} orders_reconciled=${state.reconciled} at=${new Date().toISOString()}`
    );
    const wait = Math.max(0, INTERVAL_MS - (Date.now() - started));
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  console.info(`[worker] received ${signal}; finishing current tick then stopping`);
  await sql.end({ timeout: 5 });
  console.info(`[worker] stopped after ${state.ticks} tick(s)`);
  process.exit(0);
}

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
void loop();
