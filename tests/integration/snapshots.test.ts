// Immutable price/policy snapshots and versioned configuration (docs/05 conventions, docs/08 T09/T10 groundwork).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createBookingHold, createQuote, type QuoteResult, type Sql } from "@simply-sit/db";
import { claimsFor, createUser, createVenue, expectDomainError, istSlot, openDb, type TestUser, type TestVenue } from "./helpers";

let sql: Sql;
let user: TestUser;
let venue: TestVenue;
beforeAll(async () => {
  sql = openDb();
  user = await createUser(sql);
  venue = await createVenue(sql, { policy: { byo_details: "Version one food rule" } });
});
afterAll(async () => {
  await sql.end();
});

const quote = (startAt: string) =>
  asUser(sql, claimsFor(user), (tx) =>
    createQuote(tx, { venue_id: venue.venueId, resource_id: venue.tableIds[0]!, start_at: startAt, duration_minutes: 60, party_size: 2 }));
const hold = (q: QuoteResult) =>
  asUser(sql, claimsFor(user), (tx) =>
    createBookingHold(tx, { quote_id: q.quote_id, accepted_policy_hash: q.policy_hash, expected_quote_total_paise: q.price_snapshot.total_paise }));

async function publishPolicyVersion2() {
  const [p2] = await sql`
    insert into public.venue_policies (
      venue_id, policy_version, status, source_policy_version, byo_food, byo_details, outside_delivery,
      handover_instructions, house_rules, cancel_cutoff_minutes, early_refund_bps, late_refund_bps, no_show_refund_bps,
      minimum_minutes, increment_minutes, maximum_minutes, buffer_minutes, grace_minutes, lead_minutes, max_horizon_days,
      hold_minutes, quote_ttl_minutes, end_reminder_minutes, effective_from, accepted_terms_version)
    values (${venue.venueId}::uuid, 2, 'PUBLISHED', 'proposed-2026-10-25', 'NOT_ALLOWED', 'Version two food rule',
            'NOT_ALLOWED', 'Test handover', 'Test rules', 120, 10000, 0, 0, 60, 30, 240, 10, 15, 15, 30, 5, 5, 10,
            now(), 'draft-terms-2026-10-26')
    returning id, content_hash`;
  await sql`update public.venues set active_policy_id = ${p2!.id as string}::uuid where id = ${venue.venueId}::uuid`;
  return p2!;
}

describe("policy snapshots", () => {
  it("keeps a booking's accepted snapshot when the venue publishes a new policy, and refuses a stale quote", async () => {
    const held = await hold(await quote(istSlot(2, "10:00")));
    const staleQuote = await quote(istSlot(2, "13:00"));
    const v2 = await publishPolicyVersion2();

    const [booking] = await sql`select policy_snapshot, accepted_policy_hash from public.bookings where id = ${held.booking_id}::uuid`;
    expect((booking!.policy_snapshot as { byo_details: string }).byo_details).toBe("Version one food rule");
    expect(booking!.accepted_policy_hash).not.toBe(v2.content_hash);

    await expectDomainError(hold(staleQuote), "QUOTE_CHANGED");
    const fresh = await quote(istSlot(2, "15:00"));
    expect(fresh.policy_snapshot.byo_details).toBe("Version two food rule");
    expect(fresh.policy_hash).toBe(v2.content_hash);
  });

  it("computes the policy hash in the database from the snapshot, so it cannot be supplied by a caller", async () => {
    const [row] = await sql`
      select content_hash = app.policy_hash(app.policy_snapshot(p)) as matches, content_hash
      from public.venue_policies p where id = ${venue.policyId}::uuid`;
    expect(row!.matches).toBe(true);
    expect(row!.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("immutability guards (even for the privileged connection)", () => {
  it("refuses to edit or delete a published policy", async () => {
    await expect(sql`update public.venue_policies set byo_details = 'edited' where id = ${venue.policyId}::uuid`)
      .rejects.toMatchObject({ message: "IMMUTABLE_RECORD" });
    await expect(sql`delete from public.venue_policies where id = ${venue.policyId}::uuid`)
      .rejects.toMatchObject({ message: "IMMUTABLE_RECORD" });
  });

  it("refuses to change a booking's price snapshot, identity or time, or to skip states", async () => {
    const held = await hold(await quote(istSlot(3, "10:00")));
    await expect(sql`update public.bookings set total_paise = 1 where id = ${held.booking_id}::uuid`)
      .rejects.toMatchObject({ message: "IMMUTABLE_RECORD" });
    await expect(sql`update public.bookings set price_snapshot = '{}'::jsonb where id = ${held.booking_id}::uuid`)
      .rejects.toMatchObject({ message: "IMMUTABLE_RECORD" });
    await expect(sql`update public.bookings set start_at = start_at + interval '1 hour' where id = ${held.booking_id}::uuid`)
      .rejects.toMatchObject({ message: "IMMUTABLE_RECORD" });
    await expect(sql`update public.bookings set status = 'COMPLETED' where id = ${held.booking_id}::uuid`)
      .rejects.toMatchObject({ message: "INVALID_TRANSITION" });
    await expect(sql`delete from public.bookings where id = ${held.booking_id}::uuid`)
      .rejects.toMatchObject({ message: "IMMUTABLE_RECORD" });
  });

  it("keeps booking events and audit events append-only", async () => {
    const [event] = await sql`select id from public.booking_events limit 1`;
    await expect(sql`update public.booking_events set event_type = 'X' where id = ${event!.id as string}::uuid`)
      .rejects.toMatchObject({ message: "IMMUTABLE_RECORD" });
  });

  it("refuses overlapping rate periods and edits to historical rates", async () => {
    await expect(sql`
      insert into public.resource_rates (resource_id, rate_version, hourly_paise, effective_from, fee_config_version)
      values (${venue.tableIds[0]!}::uuid, 2, 99900, '2026-06-01T00:00:00Z', 'SANDBOX-ZERO-2026-10')`)
      .rejects.toMatchObject({ code: "23P01" });
    await expect(sql`update public.resource_rates set hourly_paise = 1 where resource_id = ${venue.tableIds[0]!}::uuid`)
      .rejects.toMatchObject({ message: "IMMUTABLE_RECORD" });
  });

  it("refuses retroactive edits to an approved fee configuration", async () => {
    await expect(sql`update public.fee_configurations set commission_bps = 500 where config_version = 'SANDBOX-ZERO-2026-10'`)
      .rejects.toMatchObject({ message: "IMMUTABLE_RECORD" });
  });
});
