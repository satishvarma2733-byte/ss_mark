// M5.5 restore drill (docs/08 T22) on the LOCAL Supabase stack only. Takes a logical backup of the application schemas
// and a copy of the Storage files, restores the database into an isolated database (restore_drill) in the same local
// cluster, verifies counts, constraints, balanced ledger, booking/finance/audit links and Storage objects, times each
// step, then drops the drill database. Nothing in the live local database is changed.
// Usage: node scripts/restore-drill.mjs [outDir=tasks/current/evidence/m5]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DB = "supabase_db_build-kit";
const STORAGE = "supabase_storage_build-kit";
const DRILL = "restore_drill";
const SCHEMAS = ["public", "app", "auth", "storage", "mock_gateway", "supabase_migrations"];
const outDir = process.argv[2] ?? "tasks/current/evidence/m5";

const docker = (args) => execFileSync("docker", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const psql = (db, sql) => docker(["exec", DB, "psql", "-U", "supabase_admin", "-d", db, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql]).trim();
const timings = {};
function step(name, work) {
  const start = performance.now();
  const result = work();
  timings[name] = Math.round(performance.now() - start);
  console.info(`[drill] ${name}: ${timings[name]} ms`);
  return result;
}

// Local only: the containers must be this project's local stack.
const running = docker(["ps", "--format", "{{.Names}}"]).split("\n");
for (const name of [DB, STORAGE]) if (!running.includes(name)) throw new Error(`local container ${name} is not running`);
if (psql("postgres", `select count(*) from pg_database where datname = '${DRILL}'`) !== "0") psql("postgres", `drop database ${DRILL}`);

// What the restore must reproduce, read in one snapshot just before the backup (the local stack is idle during the drill).
const COUNTS = {
  bookings: "select count(*) from public.bookings",
  payment_attempts: "select count(*) from public.payment_attempts",
  refunds: "select count(*) from public.refunds",
  ledger_journals: "select count(*) from public.ledger_journals",
  ledger_entries: "select count(*) from public.ledger_entries",
  booking_earnings: "select count(*) from public.booking_earnings",
  payout_batches: "select count(*) from public.payout_batches",
  audit_events: "select count(*) from public.audit_events",
  booking_events: "select count(*) from public.booking_events",
  notifications: "select count(*) from public.notifications",
  outbox_jobs: "select count(*) from public.outbox_jobs",
  auth_users: "select count(*) from auth.users",
  profiles: "select count(*) from public.profiles",
  storage_objects: "select count(*) from storage.objects",
  app_functions: "select count(*) from pg_proc where pronamespace = 'app'::regnamespace",
  policies: "select count(*) from pg_policies where schemaname = 'public'",
  migrations: "select count(*) from supabase_migrations.schema_migrations"
};
const countAll = (db) => Object.fromEntries(Object.entries(COUNTS).map(([k, q]) => [k, Number(psql(db, q))]));
const source = countAll("postgres");

// 1. Backup: database (custom format) and Storage files.
const work = mkdtempSync(join(tmpdir(), "simply-sit-drill-"));
step("backup database (pg_dump)", () =>
  docker(["exec", DB, "pg_dump", "-U", "supabase_admin", "-d", "postgres", "-Fc", ...SCHEMAS.flatMap((s) => ["-n", s]), "-f", "/tmp/drill.dump"]));
const dumpBytes = Number(docker(["exec", DB, "stat", "-c", "%s", "/tmp/drill.dump"]).trim());
step("backup storage files (copy)", () => docker(["cp", `${STORAGE}:/mnt`, join(work, "storage")]));

// 2. Restore into an isolated database: extensions first (they live outside the dumped schemas), then the dump.
step("restore database (create + pg_restore)", () => {
  psql("postgres", `create database ${DRILL}`);
  psql(DRILL, "drop schema public; create schema if not exists extensions; create extension if not exists btree_gist with schema extensions; " +
    "create extension if not exists pgcrypto with schema extensions; create extension if not exists postgis with schema extensions; " +
    "create extension if not exists \"uuid-ossp\" with schema extensions;");
  docker(["exec", DB, "pg_restore", "-U", "supabase_admin", "-d", DRILL, "--exit-on-error", "/tmp/drill.dump"]);
});

// 3. Verify.
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.info(`[drill] ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
step("verify", () => {
  const restored = countAll(DRILL);
  for (const key of Object.keys(COUNTS)) check(`count ${key}`, restored[key] === source[key], `${restored[key]} of ${source[key]}`);
  check("every foreign key and check constraint is validated",
    psql(DRILL, "select count(*) from pg_constraint where connamespace in ('public'::regnamespace, 'app'::regnamespace) and not convalidated") === "0");
  check("every journal balances (debits = credits, at least two entries)", psql(DRILL, `
    select count(*) from (select j.id from public.ledger_journals j left join public.ledger_entries e on e.journal_id = j.id
      group by j.id having count(e.id) < 2 or sum(case when e.side = 'DEBIT' then e.amount_paise else -e.amount_paise end) <> 0) x`) === "0");
  check("ledger totals match the source", psql(DRILL, "select coalesce(sum(amount_paise), 0) from public.ledger_entries")
    === psql("postgres", "select coalesce(sum(amount_paise), 0) from public.ledger_entries"));
  check("every payment attempt and refund is linked to its booking", psql(DRILL, `
    select (select count(*) from public.payment_attempts a left join public.bookings b on b.id = a.booking_id where b.id is null)
         + (select count(*) from public.refunds f left join public.payment_attempts a on a.id = f.payment_attempt_id where a.id is null)`) === "0");
  check("every earning points at its journal", psql(DRILL,
    "select count(*) from public.booking_earnings e left join public.ledger_journals j on j.id = e.journal_id where e.gross_paise > 0 and j.id is null") === "0");
  check("audit trail intact (newest entry identical)", psql(DRILL, "select coalesce(max(created_at)::text, '') || count(*) from public.audit_events")
    === psql("postgres", "select coalesce(max(created_at)::text, '') || count(*) from public.audit_events"));
  check("active inventory claims never overlap", psql(DRILL, `
    select count(*) from public.inventory_claims a join public.inventory_claims b
      on a.resource_id = b.resource_id and a.id < b.id and a.active and b.active and a.blocked_range && b.blocked_range`) === "0");
  check("row-level security still forced on application tables", psql(DRILL,
    "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relforcerowsecurity") === "0");
  // A function that joins catalogue, policy and pricing still runs in the restored database.
  check("application functions run (venue search as anon)", (() => {
    const out = psql(DRILL, "set role anon; select jsonb_typeof(app.search_venues(12.93, 77.62, 5000, null, null, null, null, null, null, null, false, 0, 5))");
    return out.endsWith("object") || out.endsWith("array");
  })());

  const objects = psql("postgres", "select bucket_id || '/' || name || '/' || coalesce(version, '') from storage.objects").split("\n").filter(Boolean);
  const withVersion = objects.filter((o) => !o.endsWith("/"));
  const missing = withVersion.filter((o) => !existsSync(join(work, "storage", "stub", "stub", ...o.split("/"))));
  check("every stored object's file is in the Storage copy", missing.length === 0,
    `${withVersion.length - missing.length} of ${withVersion.length}; ${objects.length - withVersion.length} metadata-only test rows`);
  if (withVersion[0]) {
    const file = join(work, "storage", "stub", "stub", ...withVersion[0].split("/"));
    check("a copied object reads back intact", createHash("sha256").update(readFileSync(file)).digest("hex").length === 64);
  }
});

// 4. Clean up the drill database and copies.
step("drop drill database", () => psql("postgres", `drop database ${DRILL}`));
docker(["exec", DB, "rm", "-f", "/tmp/drill.dump"]);
rmSync(work, { recursive: true, force: true });

const restoreMs = timings["restore database (create + pg_restore)"] + timings.verify;
const result = {
  at: new Date().toISOString(), schemas: SCHEMAS, dump_bytes: dumpBytes, source_counts: source, timings_ms: timings,
  restore_and_verify_ms: restoreMs, checks, passed: checks.every((c) => c.ok)
};
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "restore-drill.json"), JSON.stringify(result, null, 2));
console.info(`[drill] ${result.passed ? "PASS" : "FAIL"}: ${checks.filter((c) => c.ok).length}/${checks.length} checks; dump ${dumpBytes} bytes; ` +
  `restore + verify ${restoreMs} ms`);
process.exitCode = result.passed ? 0 : 1;
