// Single source of truth checks: the database prices quotes; packages/domain and packages/synthetic-data must agree with it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createQuote, type Sql } from "@simply-sit/db";
import { POLICY_PROPOSED_2026_10_25, quoteTable } from "@simply-sit/domain";
import { SYNTHETIC_TABLES, SYNTHETIC_VENUES } from "@simply-sit/synthetic-data";
import { claimsFor, createUser, istDate, istSlot, openDb, type TestUser } from "./helpers";

let sql: Sql;
let user: TestUser;
beforeAll(async () => {
  sql = openDb();
  user = await createUser(sql);
});
afterAll(async () => {
  await sql.end();
});

const FOOD_MODE = { allowed: "ALLOWED", restricted: "RESTRICTED", prohibited: "NOT_ALLOWED" } as const;

describe("seeded policies equal the versioned TypeScript policy", () => {
  it("matches POLICY_PROPOSED_2026_10_25 for every seeded venue", async () => {
    const p = POLICY_PROPOSED_2026_10_25;
    const rows = await sql`
      select v.slug, vp.* from public.venue_policies vp join public.venues v on v.id = vp.venue_id
      where v.slug like 'demo-%' and vp.status = 'PUBLISHED'`;
    expect(rows.length).toBe(7);
    for (const row of rows) {
      expect(row).toMatchObject({
        source_policy_version: p.version,
        minimum_minutes: p.minimumMinutes,
        increment_minutes: p.incrementMinutes,
        maximum_minutes: p.maximumMinutes,
        lead_minutes: p.leadMinutes,
        max_horizon_days: p.horizonDays,
        hold_minutes: p.holdMinutes,
        buffer_minutes: p.cleaningBufferMinutes,
        grace_minutes: p.lateGraceMinutes,
        end_reminder_minutes: p.endReminderMinutes,
        cancel_cutoff_minutes: p.fullRefundCutoffMinutes
      });
    }
  });
});

describe("synthetic fixtures equal the seeded database", () => {
  it("has the same venues, categories, localities, food rules and starting prices", async () => {
    for (const fixture of SYNTHETIC_VENUES) {
      const [row] = await sql`
        select v.name, lower(v.category_code) as category, v.locality, p.byo_food, p.byo_details,
               (select min(rr.hourly_paise) from public.resources r join public.resource_rates rr on rr.resource_id = r.id
                 where r.venue_id = v.id) as from_hourly
        from public.venues v join public.venue_policies p on p.id = v.active_policy_id where v.slug = ${fixture.id}`;
      expect(row, fixture.id).toBeDefined();
      expect(row).toMatchObject({
        name: fixture.name,
        category: fixture.category,
        locality: fixture.locality,
        byo_food: FOOD_MODE[fixture.foodPolicy.mode],
        byo_details: fixture.foodPolicy.note
      });
      expect(row!.from_hourly).toBe(fixture.tableFromPrice.amountPaise * 2);
    }
  });

  it("prices every synthetic table identically in the database and in packages/domain", async () => {
    // Far-future non-Sunday afternoons (the workspace is closed on Sundays) avoid other tests' holds on seeded venues.
    const days = Array.from({ length: 10 }, (_, i) => 18 + i)
      .filter((d) => new Date(`${istDate(d)}T00:00:00Z`).getUTCDay() !== 0)
      .slice(0, 4);
    for (const table of SYNTHETIC_TABLES) {
      const [row] = await sql`
        select v.id as venue_id, r.id as resource_id, rr.hourly_paise
        from public.resources r join public.venues v on v.id = r.venue_id
        join public.resource_rates rr on rr.resource_id = r.id
        where v.slug = ${table.venueId} and r.label = ${table.label}`;
      expect(row, table.id).toBeDefined();
      expect(row!.hourly_paise).toBe(table.pricePerBlockPaise * 2);
      for (const [index, minutes] of [60, 90, 150, 240].entries()) {
        const q = await asUser(sql, claimsFor(user), (tx) =>
          createQuote(tx, {
            venue_id: row!.venue_id as string,
            resource_id: row!.resource_id as string,
            start_at: istSlot(days[index]!, "13:00"),
            duration_minutes: minutes,
            party_size: 1
          }));
        expect(q.price_snapshot.total_paise, `${table.id} ${minutes}m`).toBe(
          quoteTable({ pricePerBlockPaise: table.pricePerBlockPaise, durationMinutes: minutes }).totalPaise
        );
        expect(q.price_snapshot.synthetic).toBe(true);
      }
    }
  });
});

describe("deterministic paise rounding", () => {
  it("rounds half up in integer arithmetic", async () => {
    const [row] = await sql`
      select app.div_half_up(30001 * 90, 60) as a, app.div_half_up(1, 2) as b, app.div_half_up(1, 3) as c,
             app.div_half_up(25000 * 60, 60) as d`;
    expect(row).toEqual({ a: 45002, b: 1, c: 0, d: 25000 });
  });
});
