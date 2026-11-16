// M3.1/M3.2 discovery and availability on real PostgreSQL (docs/07 s.2; docs/08 T01, T03, T19).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, searchVenues, venueDayAvailability, venueDetail, type Sql, type VenueSearchInput } from "@simply-sit/db";
import { createUser, createVenue, holdTable, istDate, istSlot, openDb, type TestVenue } from "./helpers";

let sql: Sql;
let venue: TestVenue;
let draft: TestVenue;

const query = (overrides: Partial<VenueSearchInput> = {}): VenueSearchInput => ({
  lat: null, lng: null, radius_m: null, start_at: null, duration_minutes: null, party_size: null, categories: null,
  requirements: null, environment: null, amenities: null, available_only: false, offset: 0, limit: 100, ...overrides
});
const search = (q: Partial<VenueSearchInput>) => asAnon(sql, (tx) => searchVenues(tx, query(q)));
const ids = (result: Awaited<ReturnType<typeof search>>) => result.venues.map((v) => v.id);

beforeAll(async () => {
  sql = openDb();
  venue = await createVenue(sql, { tables: [{ capacity: 2, hourlyPaise: 20000 }] });
  draft = await createVenue(sql, { publish: false });
  await sql`insert into public.venue_tags (venue_id, tag_group, tag_code) values
            (${venue.venueId}::uuid, 'ENVIRONMENT', 'QUIET'), (${venue.venueId}::uuid, 'REQUIREMENT', 'STUDY')`;
  await sql`insert into public.venue_amenities (venue_id, code) values (${venue.venueId}::uuid, 'WIFI')`;
});
afterAll(async () => {
  await sql.end();
});

describe("venue search (T01)", () => {
  it("returns published venues only, with rules and an indicative from-price", async () => {
    const result = await search({});
    expect(ids(result)).toContain(venue.venueId);
    expect(ids(result)).not.toContain(draft.venueId);
    expect(ids(result)).not.toContain("22222222-2222-4222-8222-000000000008"); // seeded draft
    const item = result.venues.find((v) => v.id === venue.venueId)!;
    expect(item).toMatchObject({ byo_food: "ALLOWED", from_hourly_paise: 20000, is_synthetic: true, max_capacity: 2, availability: null });
  });

  it("filters by party size, tags and amenities, and rejects nothing silently", async () => {
    expect(ids(await search({ party_size: 3 }))).not.toContain(venue.venueId);
    expect(ids(await search({ environment: ["QUIET"], requirements: ["STUDY"], amenities: ["WIFI"] }))).toContain(venue.venueId);
    expect(ids(await search({ environment: ["QUIET", "OUTDOOR"] }))).not.toContain(venue.venueId);
    expect(ids(await search({ categories: ["BREWERY"] }))).not.toContain(venue.venueId);
  });

  it("orders by distance from a rounded origin and limits to the radius", async () => {
    // Test venues sit at 12.93, 77.62 (fictional point).
    const near = await search({ lat: 12.9312, lng: 77.6211, radius_m: 2000 });
    const item = near.venues.find((v) => v.id === venue.venueId);
    expect(item?.distance_m).toBeTypeOf("number");
    const far = await search({ lat: 13.2, lng: 77.9, radius_m: 2000 });
    expect(ids(far)).not.toContain(venue.venueId);
    // Precision beyond about 1 km is discarded: two nearby origins give the same distances.
    const a = await search({ lat: 12.93111, lng: 77.62111 });
    const b = await search({ lat: 12.93444, lng: 77.62444 });
    expect(a.venues.find((v) => v.id === venue.venueId)?.distance_m).toBe(b.venues.find((v) => v.id === venue.venueId)?.distance_m);
  });

  it("reports availability for a slot and can hide fully booked venues", async () => {
    const slot = istSlot(4, "11:00");
    const before = await search({ start_at: slot, duration_minutes: 60, party_size: 2 });
    expect(before.venues.find((v) => v.id === venue.venueId)?.availability).toEqual({ available_tables: 1, checked_tables: 1, problems: [] });

    await holdTable(sql, await createUser(sql), venue, slot);
    const after = await search({ start_at: slot, duration_minutes: 60, party_size: 2 });
    expect(after.venues.find((v) => v.id === venue.venueId)?.availability).toEqual({ available_tables: 0, checked_tables: 1, problems: ["BOOKED"] });
    expect(ids(await search({ start_at: slot, duration_minutes: 60, party_size: 2, available_only: true }))).not.toContain(venue.venueId);

    const night = await search({ start_at: istSlot(4, "23:00"), duration_minutes: 60, party_size: 2 });
    expect(night.venues.find((v) => v.id === venue.venueId)?.availability?.problems).toEqual(["OUTSIDE_HOURS"]);
  });

  it("pages results with a stable total", async () => {
    const first = await search({ limit: 2 });
    expect(first.venues).toHaveLength(2);
    expect(first.next_offset).toBe(2);
    const second = await search({ limit: 2, offset: 2 });
    expect(second.total).toBe(first.total);
    expect(ids(second).some((id) => ids(first).includes(id))).toBe(false);
  });
});

describe("venue detail and day availability (T03)", () => {
  it("hides unpublished venues", async () => {
    expect(await asAnon(sql, (tx) => venueDetail(tx, draft.venueId))).toBeNull();
    const detail = await asAnon(sql, (tx) => venueDetail(tx, venue.venueId));
    expect(detail).toMatchObject({ id: venue.venueId, policy: { byo_food: "ALLOWED", buffer_minutes: 10 } });
  });

  it("lists grid starts inside hours, excluding a held slot and its cleaning buffer", async () => {
    const date = istDate(5);
    const free = await asAnon(sql, (tx) => venueDayAvailability(tx, venue.venueId, date, 60, 2));
    const starts = (free.tables as { starts: string[] }[])[0]!.starts;
    expect(starts[0]).toBe(new Date(istSlot(5, "08:00")).toISOString().replace(".000Z", "+00:00"));
    // 08:00-22:00 with a 10-minute buffer: the last 60-minute start is 20:30.
    expect(starts.at(-1)).toBe(new Date(istSlot(5, "20:30")).toISOString().replace(".000Z", "+00:00"));

    await holdTable(sql, await createUser(sql), venue, istSlot(5, "10:00"));
    const held = await asAnon(sql, (tx) => venueDayAvailability(tx, venue.venueId, date, 60, 2));
    const after = new Set((held.tables as { starts: string[] }[])[0]!.starts.map((s) => new Date(s).toISOString()));
    // A 09:00 start would run to 10:00 plus its own 10-minute buffer, overlapping the 10:00 hold.
    for (const blocked of ["09:00", "09:30", "10:00", "10:30", "11:00"]) expect(after.has(new Date(istSlot(5, blocked)).toISOString())).toBe(false);
    expect(after.has(new Date(istSlot(5, "08:30")).toISOString())).toBe(true);
    expect(after.has(new Date(istSlot(5, "11:30")).toISOString())).toBe(true);

    const tooMany = await asAnon(sql, (tx) => venueDayAvailability(tx, venue.venueId, date, 60, 3));
    expect(tooMany).toMatchObject({ tables: [], reason: "PARTY_TOO_LARGE" });
  });
});
