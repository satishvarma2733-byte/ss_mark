// M2.5 durable outbox on real PostgreSQL (docs/07 s.8 "Worker crashes after external operation", docs/08 T16).
// Leases are filtered to the diagnostic kind with unique business keys, so these tests never touch other queued work.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyDiagnosticEffect, asUser, asWorker, completeJob, createBookingHold, createQuote, expireDueHolds, failJob,
  jobBookingHoldExpired, leaseJobs, purgeOperationalData, type Sql
} from "@simply-sit/db";
import { claimsFor, createUser, createVenue, istSlot, openDb } from "./helpers";

let sql: Sql;
beforeAll(async () => {
  sql = openDb();
  // A running `pnpm dev:worker` would lease these tests' jobs and make them fail confusingly (seen 26 Oct 2026).
  const [live] = await sql`
    select count(*)::int as n from public.worker_heartbeats where last_seen_at > clock_timestamp() - interval '20 seconds'`;
  if (live!.n > 0) throw new Error("A worker is running against the local database. Stop `pnpm dev:worker` and rerun.");
});
afterAll(async () => {
  await sql.end();
});

const DIAG = ["diagnostic.sleep"] as const;

async function enqueueDiagnostic(maxAttempts = 8) {
  const key = `test:${randomUUID()}`;
  const [row] = await sql`select app.enqueue_job(${key}, 'diagnostic.sleep', '{"ms":0}'::jsonb, null, ${maxAttempts}) as id`;
  return { key, id: row!.id as string };
}
const jobState = async (id: string) =>
  (await sql`select status, attempts, leased_by, available_at > clock_timestamp() as delayed from public.outbox_jobs where id = ${id}::uuid`)[0]!;

describe("enqueue", () => {
  it("is idempotent per business key", async () => {
    const key = `test:${randomUUID()}`;
    const [a] = await sql`select app.enqueue_job(${key}, 'diagnostic.sleep', '{}'::jsonb) as id`;
    const [b] = await sql`select app.enqueue_job(${key}, 'diagnostic.sleep', '{}'::jsonb) as id`;
    expect(a!.id).toBe(b!.id);
    const [count] = await sql`select count(*)::int as n from public.outbox_jobs where business_key = ${key}`;
    expect(count!.n).toBe(1);
  });
});

describe("leasing", () => {
  it("never leases the same job to two workers at once (SKIP LOCKED while the first lease is uncommitted)", async () => {
    const jobs = await Promise.all([enqueueDiagnostic(), enqueueDiagnostic(), enqueueDiagnostic()]);
    const ours = new Set(jobs.map((j) => j.id));

    let releaseFirst!: () => void;
    const firstMayCommit = new Promise<void>((resolve) => (releaseFirst = resolve));
    let firstLeased!: (ids: string[]) => void;
    const firstLeasedIds = new Promise<string[]>((resolve) => (firstLeased = resolve));

    const first = asWorker(sql, async (tx) => {
      const leased = await leaseJobs(tx, "worker-one", 2, 60, [...DIAG]);
      firstLeased(leased.map((j) => j.id));
      await firstMayCommit; // keep row locks held while the second worker leases
      return leased;
    });
    const idsOne = await firstLeasedIds;
    const second = await asWorker(sql, (tx) => leaseJobs(tx, "worker-two", 10, 60, [...DIAG]));
    releaseFirst();
    await first;

    const idsTwo = second.map((j) => j.id);
    expect(idsOne.filter((id) => idsTwo.includes(id))).toEqual([]);
    const leasedOurs = [...idsOne, ...idsTwo].filter((id) => ours.has(id));
    expect(new Set(leasedOurs).size).toBe(leasedOurs.length);
  });

  it("recovers a job from a crashed worker once its lease expires; the old worker can no longer complete it", async () => {
    const job = await enqueueDiagnostic();
    const crashed = await asWorker(sql, (tx) => leaseJobs(tx, "crashed-worker", 50, 60, [...DIAG]));
    expect(crashed.map((j) => j.id)).toContain(job.id);
    // Simulate the 60-second lease running out without sleeping.
    await sql`update public.outbox_jobs set lease_until = clock_timestamp() - interval '1 second' where id = ${job.id}::uuid`;

    const recovered = await asWorker(sql, (tx) => leaseJobs(tx, "healthy-worker", 50, 60, [...DIAG]));
    const again = recovered.find((j) => j.id === job.id);
    expect(again?.attempts).toBe(2);
    expect(await asWorker(sql, (tx) => completeJob(tx, job.id, "crashed-worker"))).toBe(false);
    expect(await asWorker(sql, (tx) => completeJob(tx, job.id, "healthy-worker"))).toBe(true);
    expect((await jobState(job.id)).status).toBe("DONE");
  });

  it("backs off after a retryable failure and dead-letters after the last attempt", async () => {
    const job = await enqueueDiagnostic(2);
    await asWorker(sql, (tx) => leaseJobs(tx, "w", 50, 60, [...DIAG]));
    expect(await asWorker(sql, (tx) => failJob(tx, job.id, "w", "TEST_FAILURE", true))).toBe("READY");
    expect(await jobState(job.id)).toMatchObject({ status: "READY", attempts: 1, delayed: true });

    await sql`update public.outbox_jobs set available_at = clock_timestamp() - interval '1 second' where id = ${job.id}::uuid`;
    await asWorker(sql, (tx) => leaseJobs(tx, "w", 50, 60, [...DIAG]));
    expect(await asWorker(sql, (tx) => failJob(tx, job.id, "w", "TEST_FAILURE", true))).toBe("DEAD");
    expect(await jobState(job.id)).toMatchObject({ status: "DEAD", attempts: 2 });
  });

  it("dead-letters a non-retryable failure immediately", async () => {
    const job = await enqueueDiagnostic();
    await asWorker(sql, (tx) => leaseJobs(tx, "w", 50, 60, [...DIAG]));
    expect(await asWorker(sql, (tx) => failJob(tx, job.id, "w", "PERMANENT", false))).toBe("DEAD");
  });
});

describe("idempotent consumers", () => {
  it("applies a diagnostic effect once per business key even when delivered twice", async () => {
    const key = `effect:${randomUUID()}`;
    expect(await asWorker(sql, (tx) => applyDiagnosticEffect(tx, key, "w1"))).toBe(true);
    expect(await asWorker(sql, (tx) => applyDiagnosticEffect(tx, key, "w2"))).toBe(false);
  });

  it("creates one in-app and one email notification for an expired hold, however often the job replays", async () => {
    const venue = await createVenue(sql);
    const customer = await createUser(sql);
    const q = await asUser(sql, claimsFor(customer), (tx) =>
      createQuote(tx, { venue_id: venue.venueId, resource_id: venue.tableIds[0]!, start_at: istSlot(2, "10:00"), duration_minutes: 60, party_size: 1 }));
    const held = await asUser(sql, claimsFor(customer), (tx) =>
      createBookingHold(tx, { quote_id: q.quote_id, accepted_policy_hash: q.policy_hash, expected_quote_total_paise: q.price_snapshot.total_paise }));
    await sql`update public.bookings set hold_expires_at = clock_timestamp() - interval '1 second' where id = ${held.booking_id}::uuid`;
    await asWorker(sql, (tx) => expireDueHolds(tx, 500));

    expect(await asWorker(sql, (tx) => jobBookingHoldExpired(tx, held.booking_id))).toBe(1);
    expect(await asWorker(sql, (tx) => jobBookingHoldExpired(tx, held.booking_id))).toBe(1);
    const notes = await sql`select channel from public.notifications where booking_id = ${held.booking_id}::uuid order by channel`;
    expect(notes.map((n) => n.channel)).toEqual(["EMAIL", "IN_APP"]);
    const emailJobs = await sql`
      select count(*)::int as n from public.outbox_jobs j join public.notifications n on j.business_key = 'notification:' || n.id || ':email'
      where n.booking_id = ${held.booking_id}::uuid`;
    expect(emailJobs[0]!.n).toBe(1);
  });
});

describe("operational purge (M5.5)", () => {
  it("removes expired idempotency responses and long-expired unbooked quotes; keeps live ones and booked quotes", async () => {
    const venue = await createVenue(sql);
    const customer = await createUser(sql);
    const quote = (time: string) => asUser(sql, claimsFor(customer), (tx) =>
      createQuote(tx, { venue_id: venue.venueId, resource_id: venue.tableIds[0]!, start_at: istSlot(3, time), duration_minutes: 60, party_size: 1 }));
    const booked = await quote("10:00");
    await asUser(sql, claimsFor(customer), (tx) =>
      createBookingHold(tx, { quote_id: booked.quote_id, accepted_policy_hash: booked.policy_hash, expected_quote_total_paise: booked.price_snapshot.total_paise }));
    const unused = await quote("14:00");
    const fresh = await quote("16:00");
    // Test-only clock travel: two quotes expired eight days ago.
    await sql`update public.quotes set expires_at = now() - interval '8 days' where id in (${booked.quote_id}::uuid, ${unused.quote_id}::uuid)`;
    const scope = randomUUID();
    await sql`insert into public.idempotency_records (actor_scope, route, key, request_hash, expires_at)
              values (${scope}, 'POST /test', ${randomUUID()}, 'h', now() - interval '1 minute'),
                     (${scope}, 'POST /test', ${randomUUID()}, 'h', now() + interval '7 days')`;

    const purged = await asWorker(sql, (tx) => purgeOperationalData(tx, 5000));
    expect(purged.idempotency_records).toBeGreaterThanOrEqual(1);
    expect(purged.quotes).toBeGreaterThanOrEqual(1);
    const left = await sql`select id from public.quotes where id in (${booked.quote_id}::uuid, ${unused.quote_id}::uuid, ${fresh.quote_id}::uuid)`;
    expect(left.map((q) => q.id).sort()).toEqual([booked.quote_id, fresh.quote_id].sort());
    const [{ n }] = (await sql`select count(*)::int as n from public.idempotency_records where actor_scope = ${scope}`) as unknown as [{ n: number }];
    expect(n).toBe(1);
  });
});

describe("worker role privileges", () => {
  it("cannot read or write queue tables directly; only through app.* functions", async () => {
    await expect(asWorker(sql, (tx) => tx`select id from public.outbox_jobs limit 1`)).rejects.toMatchObject({ code: "42501" });
    await expect(asWorker(sql, (tx) => tx`select id from public.bookings limit 1`)).rejects.toMatchObject({ code: "42501" });
    await expect(asWorker(sql, (tx) => tx`select app.create_quote(gen_random_uuid(), gen_random_uuid(), now(), 60, 1)`))
      .rejects.toMatchObject({ code: "42501" });
  });
});
