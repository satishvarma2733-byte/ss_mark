// Worker crash-recovery demonstration (docs/07 s.8, docs/08 T16) against the LOCAL stack.
// 1. enqueue a slow diagnostic job; 2. worker A leases it and is hard-killed mid-job (no graceful shutdown);
// 3. worker B re-leases it after the lease expires and completes it; 4. the effect is applied exactly once.
// Usage: pnpm demo:worker-crash   (requires pnpm db:start and pnpm env:local; stop any other running worker first)
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.loadEnvFile(join(root, ".env.local"));
const url = process.env.DATABASE_URL;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("local DATABASE_URL required");

const sql = postgres(url, { max: 1, onnotice: () => {} });
const LEASE_SECONDS = 10;
const SLEEP_MS = 12_000;
const key = `demo:worker-crash:${randomUUID()}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.info(`[demo ${new Date().toISOString().slice(11, 19)}] ${msg}`);

function startWorker(id) {
  const child = spawn(process.execPath, ["--import", "tsx", join(root, "apps/worker/src/index.ts")], {
    cwd: root,
    env: { ...process.env, APP_ENV: "development", APP_MODE: "mock", WORKER_ID: id, WORKER_TICK_MS: "1000", WORKER_LEASE_SECONDS: String(LEASE_SECONDS) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (d) => String(d).split("\n").filter((l) => l.includes("diagnostic") || l.includes("started") || l.includes("lease lost")).forEach((l) => log(`${id}: ${l.trim()}`)));
  child.stderr.on("data", (d) => log(`${id} stderr: ${String(d).trim()}`));
  return child;
}

async function job() {
  const [row] = await sql`select status, attempts, leased_by, lease_until > clock_timestamp() as lease_live from public.outbox_jobs where business_key = ${key}`;
  return row;
}

const [{ id }] = await sql`select app.enqueue_job(${key}, 'diagnostic.sleep', ${sql.json({ ms: SLEEP_MS })}) as id`;
log(`enqueued ${key} (job ${id}), handler sleeps ${SLEEP_MS / 1000}s, lease ${LEASE_SECONDS}s`);

const a = startWorker("worker-A");
for (let i = 0; i < 30 && (await job()).status !== "LEASED"; i += 1) await wait(500);
log(`after worker A leased: ${JSON.stringify(await job())}`);
await wait(2000);
a.kill("SIGKILL"); // hard crash: no handler completion, no lease release
log("worker A hard-killed mid-job");
await wait(500);
const [effectsAfterCrash] = await sql`select count(*)::int as n from public.diagnostic_effects where business_key = ${key}`;
log(`after crash: job=${JSON.stringify(await job())} effects=${effectsAfterCrash.n}`);

const b = startWorker("worker-B");
for (let i = 0; i < 80 && (await job()).status !== "DONE"; i += 1) await wait(500);
const final = await job();
const effects = await sql`select worker_id from public.diagnostic_effects where business_key = ${key}`;
log(`final: job=${JSON.stringify(final)} effects=${JSON.stringify(effects.map((e) => e.worker_id))}`);
b.kill("SIGTERM");
await sql.end();

const ok = final.status === "DONE" && final.attempts === 2 && effects.length === 1 && effects[0].worker_id === "worker-B";
log(ok ? "PASS: recovered after lease expiry and applied the effect exactly once" : "FAIL");
process.exit(ok ? 0 : 1);
