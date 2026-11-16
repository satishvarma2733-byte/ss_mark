// M2.3 authorization on real PostgreSQL and the real local REST gateway (docs/05 RLS matrix, docs/08 T13/T14, AC-14).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminGrantVenueMembership, asAnon, asUser, createBookingHold, createQuote, type Sql
} from "@simply-sit/db";
import {
  claimsFor, createUser, createVenue, expectDomainError, grantPlatformRole, grantVenueRole, istSlot, openDb,
  type TestUser, type TestVenue
} from "./helpers";

let sql: Sql;
let venueA: TestVenue;
let venueB: TestVenue;
let customerA: TestUser;
let customerB: TestUser;
let staffA: TestUser;
let staffB: TestUser;
let managerA: TestUser;
let bookingId: string;

beforeAll(async () => {
  sql = openDb();
  [venueA, venueB] = [await createVenue(sql), await createVenue(sql)];
  [customerA, customerB, staffA, staffB, managerA] = await Promise.all([
    createUser(sql), createUser(sql), createUser(sql), createUser(sql), createUser(sql)
  ]);
  await grantVenueRole(sql, venueA.venueId, staffA, "STAFF");
  await grantVenueRole(sql, venueB.venueId, staffB, "STAFF");
  await grantVenueRole(sql, venueA.venueId, managerA, "MANAGER");
  const q = await asUser(sql, claimsFor(customerA), (tx) =>
    createQuote(tx, { venue_id: venueA.venueId, resource_id: venueA.tableIds[0]!, start_at: istSlot(2, "10:00"), duration_minutes: 60, party_size: 2 }));
  const held = await asUser(sql, claimsFor(customerA), (tx) =>
    createBookingHold(tx, { quote_id: q.quote_id, accepted_policy_hash: q.policy_hash, expected_quote_total_paise: q.price_snapshot.total_paise }));
  bookingId = held.booking_id;
});
afterAll(async () => {
  await sql.end();
});

describe("database-wide guarantees", () => {
  it("enables and forces RLS on every public table", async () => {
    const rows = await sql`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)`;
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("grants anon and authenticated no write privilege on any public table or column", async () => {
    const tables = await sql`
      select table_name, grantee, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'`;
    const columns = await sql`
      select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
      where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'`;
    expect(tables).toEqual([]);
    expect(columns).toEqual([]);
  });

  it("denies direct client writes even on the caller's own booking", async () => {
    await expect(asUser(sql, claimsFor(customerA), (tx) => tx`update public.bookings set party_size = 1 where id = ${bookingId}::uuid`))
      .rejects.toMatchObject({ code: "42501" });
    await expect(asUser(sql, claimsFor(customerA), (tx) =>
      tx`insert into public.inventory_claims (venue_id, resource_id, kind, blocked_range, reason)
         values (${venueA.venueId}::uuid, ${venueA.tableIds[0]!}::uuid, 'CLOSURE', '[2030-01-01,2030-01-02)', 'nope')`))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("grants no app.* function to PUBLIC; each function is granted to named roles only", async () => {
    const rows = await sql`
      select p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and (p.proacl is null or exists (
          select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
      order by 1`;
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it("lets RLS-filtered booking and claim reads use indexes (identity resolved once, not per row)", async () => {
    // With sequential scans disabled, a policy that calls a function per row can only be satisfied by a Seq Scan.
    // scripts/query-plans.sql shows the effect at pilot scale (50,000 bookings: 1,001 ms before, ~1 ms after).
    const plan = (user: TestUser, sqlText: string) =>
      asUser(sql, claimsFor(user), async (tx) => {
        await tx`set local enable_seqscan = off`;
        const rows = await tx.unsafe(`explain (costs off) ${sqlText}`);
        return rows.map((r) => String(r["QUERY PLAN"])).join("\n");
      });
    const ownBookings = await plan(customerA, "select id from public.bookings order by start_at desc limit 20");
    expect(ownBookings).not.toMatch(/Seq Scan on bookings/);
    expect(ownBookings).toMatch(/InitPlan/);
    const claims = await asUser(sql, claimsFor(staffA, { aal: "aal2" }), async (tx) => {
      await tx`set local enable_seqscan = off`;
      const rows = await tx.unsafe(`explain (costs off) select id from public.inventory_claims where venue_id = '${venueA.venueId}'`);
      return rows.map((r) => String(r["QUERY PLAN"])).join(" | ");
    });
    expect(claims).not.toMatch(/Seq Scan on inventory_claims/);
  });

  it("does not let anon execute domain mutations", async () => {
    await expect(asAnon(sql, (tx) => tx`select app.create_quote(gen_random_uuid(), gen_random_uuid(), now(), 60, 1)`))
      .rejects.toMatchObject({ code: "42501" });
  });
});

describe("public catalogue (anon)", () => {
  it("shows published venues and hides drafts with their policies and tables", async () => {
    const rows = await asAnon(sql, (tx) => tx`
      select slug, status from public.venues where slug in ('demo-cafe-koramangala', 'demo-cowork-whitefield-draft')`);
    expect(rows).toEqual([{ slug: "demo-cafe-koramangala", status: "PUBLISHED" }]);
    const draftPolicies = await asAnon(sql, (tx) => tx`
      select p.id from public.venue_policies p where p.venue_id = '22222222-2222-4222-8222-000000000008'`);
    const draftTables = await asAnon(sql, (tx) => tx`
      select r.id from public.resources r where r.venue_id = '22222222-2222-4222-8222-000000000008'`);
    expect(draftPolicies).toEqual([]);
    expect(draftTables).toEqual([]);
  });

  it("cannot read private tables at all", async () => {
    for (const table of ["profiles", "bookings", "quotes", "inventory_claims", "notifications", "outbox_jobs", "partners"]) {
      await expect(asAnon(sql, (tx) => tx.unsafe(`select 1 from public.${table} limit 1`)), table).rejects.toMatchObject({ code: "42501" });
    }
  });
});

describe("tenant isolation (AC-14)", () => {
  it("shows a booking row to its customer and to MFA-verified venue managers only (review R1)", async () => {
    const see = (user: TestUser, aal: "aal1" | "aal2" = "aal1") =>
      asUser(sql, claimsFor(user, { aal }), (tx) => tx`select id from public.bookings where id = ${bookingId}::uuid`);
    expect(await see(customerA)).toHaveLength(1);
    expect(await see(managerA, "aal2")).toHaveLength(1);
    expect(await see(managerA, "aal1")).toHaveLength(0);
    // Staff use the column-minimal arrivals projection (arrival.test.ts), never booking rows with prices.
    expect(await see(staffA, "aal2")).toHaveLength(0);
    expect(await see(staffA)).toHaveLength(0);
    expect(await see(customerB)).toHaveLength(0);
    expect(await see(staffB, "aal2")).toHaveLength(0);
  });

  it("limits inventory claims and booking events to assigned, MFA-verified venue members", async () => {
    const claims = (user: TestUser, aal: "aal1" | "aal2" = "aal2") =>
      asUser(sql, claimsFor(user, { aal }), (tx) => tx`select id from public.inventory_claims where venue_id = ${venueA.venueId}::uuid`);
    expect((await claims(staffA)).length).toBeGreaterThan(0);
    expect(await claims(staffA, "aal1")).toHaveLength(0);
    expect(await claims(staffB)).toHaveLength(0);
    expect(await claims(customerA)).toHaveLength(0);
    const events = await asUser(sql, claimsFor(customerB), (tx) => tx`select id from public.booking_events where booking_id = ${bookingId}::uuid`);
    expect(events).toHaveLength(0);
  });

  it("never grants the check-in token hash, partner provider reference or staff notes", async () => {
    await expect(asUser(sql, claimsFor(customerA), (tx) => tx`select checkin_token_hash from public.bookings`))
      .rejects.toMatchObject({ code: "42501" });
    await expect(asUser(sql, claimsFor(managerA), (tx) => tx`select provider_account_ref from public.partners`))
      .rejects.toMatchObject({ code: "42501" });
    await expect(asUser(sql, claimsFor(staffA), (tx) => tx`select staff_note from public.resources`))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("shows each user only their own profile and roles", async () => {
    const profiles = await asUser(sql, claimsFor(customerB), (tx) => tx`select id from public.profiles`);
    expect(profiles.map((p) => p.id)).toEqual([customerB.profileId]);
    const memberships = await asUser(sql, claimsFor(staffB), (tx) => tx`select venue_id from public.venue_memberships`);
    expect(memberships.map((m) => m.venue_id)).toEqual([venueB.venueId]);
  });

  it("removes access as soon as a membership is revoked (no stale role)", async () => {
    const temp = await createUser(sql);
    await grantVenueRole(sql, venueA.venueId, temp, "MANAGER");
    const read = () => asUser(sql, claimsFor(temp, { aal: "aal2" }), (tx) => tx`select id from public.bookings where id = ${bookingId}::uuid`);
    expect(await read()).toHaveLength(1);
    await sql`update public.venue_memberships set status = 'REVOKED' where user_id = ${temp.profileId}::uuid`;
    expect(await read()).toHaveLength(0);
  });
});

describe("terms acceptance (review R2)", () => {
  it("requires the current terms version, not just any version, before holding a table", async () => {
    const stale = await createUser(sql);
    await sql`update public.profiles set terms_version = 'draft-terms-2026-01-01' where id = ${stale.profileId}::uuid`;
    const q = await asUser(sql, claimsFor(stale), (tx) =>
      createQuote(tx, { venue_id: venueA.venueId, resource_id: venueA.tableIds[0]!, start_at: istSlot(3, "15:00"), duration_minutes: 60, party_size: 2 }));
    const details = await expectDomainError(asUser(sql, claimsFor(stale), (tx) =>
      createBookingHold(tx, { quote_id: q.quote_id, accepted_policy_hash: q.policy_hash, expected_quote_total_paise: q.price_snapshot.total_paise })),
      "POLICY_NOT_ACCEPTED");
    expect(details).toMatchObject({ field: "terms" });
  });
});

describe("platform roles", () => {
  it("lets only an MFA-verified superadmin grant a venue role, and audits it", async () => {
    const admin = await createUser(sql);
    await grantPlatformRole(sql, admin, "SUPERADMIN");
    const target = await createUser(sql);
    const grant = (user: TestUser, aal: "aal1" | "aal2") =>
      asUser(sql, claimsFor(user, { aal }), (tx) =>
        adminGrantVenueMembership(tx, { venue_id: venueB.venueId, profile_id: target.profileId, role: "STAFF", reason: "Test grant" }));
    await expectDomainError(grant(managerA, "aal2"), "FORBIDDEN");
    await expectDomainError(grant(admin, "aal1"), "REAUTH_REQUIRED");
    const granted = await grant(admin, "aal2");
    expect(granted.status).toBe("ACTIVE");
    const [audit] = await sql`select action, actor_role from public.audit_events where entity_id = ${granted.membership_id}::uuid`;
    expect(audit).toMatchObject({ action: "membership.grant", actor_role: "SUPERADMIN" });
  });
});

describe("private storage bucket", () => {
  it("lets a customer read only their own privacy export objects", async () => {
    const key = `${customerA.profileId}/export-test.json`;
    await sql`insert into storage.objects (bucket_id, name, owner_id) values ('privacy-exports', ${key}, ${customerA.authUserId})`;
    const read = (user: TestUser) =>
      asUser(sql, claimsFor(user), (tx) => tx`select name from storage.objects where bucket_id = 'privacy-exports' and name = ${key}`);
    expect(await read(customerA)).toHaveLength(1);
    expect(await read(customerB)).toHaveLength(0);
    const anon = await asAnon(sql, (tx) => tx`select name from storage.objects where bucket_id = 'privacy-exports'`).catch(() => []);
    expect(anon).toHaveLength(0);
  });
});

describe("what the public REST gateway exposes with the publishable key", () => {
  const api = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const headers = { apikey: key ?? "", "content-type": "application/json" };

  it.runIf(api && key)("does not expose app.* domain functions", async () => {
    const response = await fetch(`${api}/rest/v1/rpc/create_quote`, { method: "POST", headers, body: "{}" });
    expect(response.status).toBe(404);
  });

  it.runIf(api && key)("serves published venues but no bookings to anonymous callers", async () => {
    const venues = await fetch(`${api}/rest/v1/venues?select=slug,status&slug=eq.demo-cowork-whitefield-draft`, { headers });
    expect(await venues.json()).toEqual([]);
    const bookings = await fetch(`${api}/rest/v1/bookings?select=id`, { headers });
    expect(bookings.status).toBe(401);
  });
});
