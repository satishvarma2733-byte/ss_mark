// M2.4 exclusive inventory on real PostgreSQL (docs/08 T04-T06, T12; docs/07 s.8 "Two holds for same table/time").
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser, asWorker, cancelHold, createBookingHold, createClosure, createQuote, expireDueHolds, type QuoteResult, type Sql
} from "@simply-sit/db";
import {
  claimsFor, createUser, createVenue, expectDomainError, grantVenueRole, istSlot, openDb, type TestUser, type TestVenue
} from "./helpers";

let sql: Sql;
beforeAll(() => {
  sql = openDb(30);
});
afterAll(async () => {
  await sql.end();
});

function quote(user: TestUser, venue: TestVenue, table: number, startAt: string, minutes = 60, party = 2) {
  return asUser(sql, claimsFor(user), (tx) =>
    createQuote(tx, { venue_id: venue.venueId, resource_id: venue.tableIds[table]!, start_at: startAt, duration_minutes: minutes, party_size: party })
  );
}
function hold(user: TestUser, q: QuoteResult) {
  return asUser(sql, claimsFor(user), (tx) =>
    createBookingHold(tx, { quote_id: q.quote_id, accepted_policy_hash: q.policy_hash, expected_quote_total_paise: q.price_snapshot.total_paise })
  );
}
async function activeClaims(resourceId: string) {
  const [row] = await sql`select count(*)::int as n from public.inventory_claims where resource_id = ${resourceId}::uuid and active`;
  return row!.n as number;
}

describe("simultaneous holds (AC-03)", () => {
  it("lets exactly one of ten concurrent customers hold the same table and time", async () => {
    const venue = await createVenue(sql);
    const users = await Promise.all(Array.from({ length: 10 }, (_, i) => createUser(sql, { label: `racer${i}` })));
    const start = istSlot(2, "11:00");
    const quotes = [];
    for (const user of users) quotes.push(await quote(user, venue, 0, start));

    const results = await Promise.allSettled(users.map((user, i) => hold(user, quotes[i]!)));
    const winners = results.filter((r) => r.status === "fulfilled");
    const losers = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(9);
    for (const loser of losers) expect((loser.reason as { code?: string }).code).toBe("SLOT_UNAVAILABLE");
    expect(await activeClaims(venue.tableIds[0]!)).toBe(1);
  });

  it("does not block a different table at the same time", async () => {
    const venue = await createVenue(sql, { tables: [{ capacity: 4, hourlyPaise: 30000 }, { capacity: 4, hourlyPaise: 30000 }] });
    const [a, b] = [await createUser(sql), await createUser(sql)];
    const start = istSlot(2, "12:00");
    const [qa, qb] = [await quote(a, venue, 0, start), await quote(b, venue, 1, start)];
    const [ha, hb] = await Promise.all([hold(a, qa), hold(b, qb)]);
    expect(ha.status).toBe("HOLD");
    expect(hb.status).toBe("HOLD");
  });
});

describe("cleaning buffer and the exclusion constraint", () => {
  it("blocks a start inside the previous booking's buffer and allows the next grid slot after it", async () => {
    const venue = await createVenue(sql);
    const [a, b] = [await createUser(sql), await createUser(sql)];
    await hold(a, await quote(a, venue, 0, istSlot(3, "10:00"), 60));
    // 10:00-11:00 plus a 10-minute buffer blocks [10:00, 11:10): an 11:00 start conflicts.
    await expectDomainError(quote(b, venue, 0, istSlot(3, "11:00"), 60), "SLOT_UNAVAILABLE");
    // 11:10 is off the 30-minute grid; 11:30 is the next valid start and is free.
    await expectDomainError(quote(b, venue, 0, istSlot(3, "11:10"), 60), "VALIDATION_FAILED");
    const later = await hold(b, await quote(b, venue, 0, istSlot(3, "11:30"), 60));
    expect(later.status).toBe("HOLD");
  });

  it("rejects an overlapping active claim even when inserted directly, bypassing the functions", async () => {
    const venue = await createVenue(sql);
    const range = `[${istSlot(4, "10:00")},${istSlot(4, "12:00")})`;
    await sql`insert into public.inventory_claims (venue_id, resource_id, kind, blocked_range, reason)
              values (${venue.venueId}::uuid, ${venue.tableIds[0]!}::uuid, 'CLOSURE', ${range}::tstzrange, 'direct insert one')`;
    const overlap = `[${istSlot(4, "11:00")},${istSlot(4, "13:00")})`;
    await expect(
      sql`insert into public.inventory_claims (venue_id, resource_id, kind, blocked_range, reason)
          values (${venue.venueId}::uuid, ${venue.tableIds[0]!}::uuid, 'CLOSURE', ${overlap}::tstzrange, 'direct insert two')`
    ).rejects.toMatchObject({ code: "23P01" });
  });
});

describe("hold expiry", () => {
  it("expires a due hold inside the next hold's lock path and lets the slot be sold again", async () => {
    const venue = await createVenue(sql);
    const [a, b] = [await createUser(sql), await createUser(sql)];
    const start = istSlot(5, "15:00");
    const first = await hold(a, await quote(a, venue, 0, start));
    // Simulate the five-minute deadline passing (the hold path samples clock_timestamp() after locking).
    await sql`update public.bookings set hold_expires_at = clock_timestamp() - interval '1 second' where id = ${first.booking_id}::uuid`;
    // The quote's advisory check ignores claims whose expires_at passed; align the claim deadline too.
    await sql`update public.inventory_claims set expires_at = clock_timestamp() - interval '1 second' where booking_id = ${first.booking_id}::uuid`;
    const second = await hold(b, await quote(b, venue, 0, start));
    expect(second.status).toBe("HOLD");

    const [old] = await sql`select status from public.bookings where id = ${first.booking_id}::uuid`;
    expect(old!.status).toBe("EXPIRED");
    const [claim] = await sql`select active from public.inventory_claims where booking_id = ${first.booking_id}::uuid`;
    expect(claim!.active).toBe(false);
    const jobs = await sql`select kind from public.outbox_jobs where business_key = ${"booking:" + first.booking_id + ":hold_expired"}`;
    expect(jobs.map((j) => j.kind)).toEqual(["booking.hold_expired"]);
    expect(await activeClaims(venue.tableIds[0]!)).toBe(1);
  });

  it("is expired by the worker sweep running as the least-privilege worker role", async () => {
    const venue = await createVenue(sql);
    const a = await createUser(sql);
    const h = await hold(a, await quote(a, venue, 0, istSlot(5, "17:00")));
    await sql`update public.bookings set hold_expires_at = clock_timestamp() - interval '1 second' where id = ${h.booking_id}::uuid`;
    const expired = await asWorker(sql, (tx) => expireDueHolds(tx, 500));
    expect(expired).toBeGreaterThanOrEqual(1);
    const [row] = await sql`select status, expired_at is not null as stamped from public.bookings where id = ${h.booking_id}::uuid`;
    expect(row).toMatchObject({ status: "EXPIRED", stamped: true });
    expect(await activeClaims(venue.tableIds[0]!)).toBe(0);
  });
});

describe("customer hold cancellation", () => {
  it("releases the claim, and rejects a stale version", async () => {
    const venue = await createVenue(sql);
    const a = await createUser(sql);
    const h = await hold(a, await quote(a, venue, 0, istSlot(6, "10:00")));
    await expectDomainError(asUser(sql, claimsFor(a), (tx) => cancelHold(tx, h.booking_id, h.version + 5)), "STALE_VERSION");
    const cancelled = await asUser(sql, claimsFor(a), (tx) => cancelHold(tx, h.booking_id, h.version));
    expect(cancelled.status).toBe("CANCELLED");
    expect(await activeClaims(venue.tableIds[0]!)).toBe(0);
    const other = await createUser(sql);
    await expectDomainError(asUser(sql, claimsFor(other), (tx) => cancelHold(tx, h.booking_id, 2)), "NOT_FOUND");
  });
});

describe("quote and hold guards", () => {
  let venue: TestVenue;
  let user: TestUser;
  beforeAll(async () => {
    venue = await createVenue(sql, { tables: [{ capacity: 2, hourlyPaise: 30000 }] });
    user = await createUser(sql);
  });

  it("rejects a changed total, a wrong policy hash and a reused quote", async () => {
    const q = await quote(user, venue, 0, istSlot(7, "10:00"));
    await expectDomainError(
      asUser(sql, claimsFor(user), (tx) =>
        createBookingHold(tx, { quote_id: q.quote_id, accepted_policy_hash: q.policy_hash, expected_quote_total_paise: 1 })),
      "QUOTE_CHANGED"
    );
    await expectDomainError(
      asUser(sql, claimsFor(user), (tx) =>
        createBookingHold(tx, { quote_id: q.quote_id, accepted_policy_hash: `sha256:${"0".repeat(64)}`, expected_quote_total_paise: q.price_snapshot.total_paise })),
      "POLICY_NOT_ACCEPTED"
    );
    await hold(user, q);
    await expectDomainError(hold(user, q), "INVALID_TRANSITION");
  });

  it("rejects an expired quote", async () => {
    const q = await quote(user, venue, 0, istSlot(7, "13:00"));
    await sql`update public.quotes set expires_at = clock_timestamp() - interval '1 second' where id = ${q.quote_id}::uuid`;
    await expectDomainError(hold(user, q), "QUOTE_EXPIRED");
  });

  it("rejects a party larger than the table, a customer without accepted terms and a deletion-pending account", async () => {
    await expectDomainError(quote(user, venue, 0, istSlot(7, "15:00"), 60, 3), "PARTY_TOO_LARGE");
    const noTerms = await createUser(sql, { acceptTerms: false });
    await expectDomainError(hold(noTerms, await quote(noTerms, venue, 0, istSlot(7, "16:00"))), "POLICY_NOT_ACCEPTED");
    const leaving = await createUser(sql);
    const q = await quote(leaving, venue, 0, istSlot(7, "17:00"));
    await sql`update public.profiles set status = 'DELETION_PENDING' where id = ${leaving.profileId}::uuid`;
    await expectDomainError(hold(leaving, q), "ACCOUNT_DELETION_PENDING");
  });

  it("does not let a customer use another customer's quote", async () => {
    const q = await quote(user, venue, 0, istSlot(8, "10:00"));
    const thief = await createUser(sql);
    await expectDomainError(hold(thief, q), "NOT_FOUND");
  });
});

describe("closures (AC-09)", () => {
  let venue: TestVenue;
  let manager: TestUser;
  let staff: TestUser;
  let customer: TestUser;
  beforeAll(async () => {
    venue = await createVenue(sql, { tables: [{ capacity: 4, hourlyPaise: 30000 }, { capacity: 4, hourlyPaise: 30000 }] });
    [manager, staff, customer] = [await createUser(sql), await createUser(sql), await createUser(sql)];
    await grantVenueRole(sql, venue.venueId, manager, "MANAGER");
    await grantVenueRole(sql, venue.venueId, staff, "STAFF");
  });
  const closure = (user: TestUser, aal: "aal1" | "aal2", start: string, end: string) =>
    asUser(sql, claimsFor(user, { aal }), (tx) =>
      createClosure(tx, { venue_id: venue.venueId, resource_ids: null, start_at: start, end_at: end, reason: "Deep clean (test)" }));

  it("distinguishes roles: staff forbidden, outsiders not found, managers need MFA", async () => {
    const [s, e] = [istSlot(9, "08:00"), istSlot(9, "09:00")];
    await expectDomainError(closure(staff, "aal2", s, e), "FORBIDDEN");
    await expectDomainError(closure(customer, "aal2", s, e), "NOT_FOUND");
    await expectDomainError(closure(manager, "aal1", s, e), "REAUTH_REQUIRED");
    const created = await closure(manager, "aal2", s, e);
    expect(created.resource_count).toBe(2);
  });

  it("refuses to close over a held booking and returns its reference; a closure then blocks new quotes", async () => {
    const h = await hold(customer, await quote(customer, venue, 0, istSlot(10, "12:00")));
    const details = await expectDomainError(closure(manager, "aal2", istSlot(10, "11:00"), istSlot(10, "14:00")), "SLOT_UNAVAILABLE");
    const conflicts = details.conflicts as { public_ref: string }[];
    expect(conflicts.map((c) => c.public_ref)).toContain(h.public_ref);

    await closure(manager, "aal2", istSlot(10, "16:00"), istSlot(10, "18:00"));
    await expectDomainError(quote(customer, venue, 1, istSlot(10, "16:30")), "SLOT_UNAVAILABLE");
  });
});
