import { describe, expect, it } from "vitest";
import { SYNTHETIC_TABLES, SYNTHETIC_VENUES } from "@simply-sit/synthetic-data";
import { openDb } from "./helpers";

// Fixture safety. Exclusive inventory is covered in inventory.test.ts and tenant isolation in rls.test.ts.
describe("synthetic fixtures", () => {
  it("flags every venue as synthetic and keeps tables tied to existing venues", () => {
    expect(SYNTHETIC_VENUES.every((venue) => venue.isSynthetic === true)).toBe(true);
    const venueIds = new Set(SYNTHETIC_VENUES.map((venue) => venue.id));
    expect(SYNTHETIC_TABLES.every((table) => venueIds.has(table.venueId))).toBe(true);
  });

  it("seeds only fictional, synthetic-flagged records and @example.test accounts", async () => {
    const sql = openDb(2);
    try {
      const [counts] = await sql`
        select
          (select count(*)::int from public.venues where slug like 'demo-%') as demo_venues,
          (select count(*)::int from public.venues where slug like 'demo-%' and not is_synthetic) as unflagged_venues,
          (select count(*)::int from public.partners where legal_name like 'DEMO %' and not is_synthetic) as unflagged_partners,
          (select count(*)::int from public.venues where slug like 'demo-%' and status = 'PUBLISHED') as published,
          (select count(distinct category_code)::int from public.venues where slug like 'demo-%') as categories,
          (select count(*)::int from auth.users where id::text like '44444444-%' and email not like '%@example.test') as real_emails`;
      expect(counts).toEqual({ demo_venues: 8, unflagged_venues: 0, unflagged_partners: 0, published: 7, categories: 6, real_emails: 0 });
    } finally {
      await sql.end();
    }
  });
});
