// Seat-map phase 1 on real PostgreSQL: seating areas, versioned floor drawings and area prices
// (supabase/migrations/20261119000200_seating_layouts.sql; docs/concepts/seat-map/PLAN.md).
// Writes need the venue's MANAGER/OWNER with TOTP; drafts are validated whole; published drawings are frozen; area
// prices are ordinary rate versions, so quotes and bookings already made keep their price.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon, asUser, createQuote, venueDayAvailability, partnerArchiveRateRule, partnerCreateRateRule, partnerArchiveZone, partnerCreateZone, partnerPublishLayout, partnerSaveLayoutDraft, partnerSeating, partnerSetTableDetails,
  partnerSetZonePrice, partnerUpdateZone, venueSeatMap, venueSeating, type Sql
} from "@simply-sit/db";
import { claimsFor, createUser, createVenue, expectDomainError, grantVenueRole, holdTable, istSlot, openDb, type TestUser, type TestVenue } from "./helpers";

let sql: Sql;
let manager: TestUser;
let staff: TestUser;
let stranger: TestUser;
let customer: TestUser;
let venue: TestVenue;

const as = (user: TestUser) => <T>(work: Parameters<typeof asUser<T>>[2]) => asUser(sql, claimsFor(user, { aal: "aal2" }), work);
const resourceVersion = async (id: string) => Number((await sql`select version from public.resources where id = ${id}::uuid`)[0]!.version);
const table = (resourceId: string, x: number, y: number, width = 80, height = 80) => ({ type: "TABLE", resource_id: resourceId, x, y, width, height });

beforeAll(async () => {
  sql = openDb(10);
  [manager, staff, stranger, customer] = [await createUser(sql), await createUser(sql), await createUser(sql), await createUser(sql)];
  venue = await createVenue(sql, {
    tables: [{ capacity: 2, hourlyPaise: 15000 }, { capacity: 4, hourlyPaise: 15000 }, { capacity: 6, hourlyPaise: 30000 }]
  });
  await grantVenueRole(sql, venue.venueId, manager, "MANAGER");
  await grantVenueRole(sql, venue.venueId, staff, "STAFF");
});
afterAll(async () => {
  await sql.end();
});

async function zoneWithTables(name: string, tableIds: string[]) {
  const zone = await as(manager)((tx) => partnerCreateZone(tx, venue.venueId, { name, kind: "INDOOR", features: ["QUIET"] }));
  for (const id of tableIds) {
    await as(manager)(async (tx) => partnerSetTableDetails(tx, id, { zone_id: zone.id as string, shape: "SQUARE", expected_version: await resourceVersion(id) }));
  }
  return zone as { id: string; version: number };
}

describe("areas and floor drawings", () => {
  it("lets a manager draw, publish and show an area; staff and strangers cannot", async () => {
    await expectDomainError(as(staff)((tx) => partnerCreateZone(tx, venue.venueId, { name: "Staff area" })), "FORBIDDEN");
    await expectDomainError(as(stranger)((tx) => partnerCreateZone(tx, venue.venueId, { name: "Other area" })), "NOT_FOUND");

    const zone = await zoneWithTables("Ground floor", [venue.tableIds[0]!, venue.tableIds[1]!]);
    await expectDomainError(as(manager)((tx) => partnerCreateZone(tx, venue.venueId, { name: "ground FLOOR" })), "VALIDATION_FAILED");

    const draft = await as(manager)((tx) => partnerSaveLayoutDraft(tx, zone.id, {
      width: 400, height: 300, expected_version: null,
      elements: [table(venue.tableIds[0]!, 20, 20), table(venue.tableIds[1]!, 200, 20, 100, 100),
                 { type: "DOOR", label: "Entrance", x: 300, y: 260, width: 90, height: 30 }]
    }));
    expect(draft).toMatchObject({ status: "DRAFT", layout_version: 1 });
    // Guests see nothing until it is published.
    expect((await asAnon(sql, (tx) => venueSeating(tx, venue.venueId))).zones).toEqual([
      expect.objectContaining({ name: "Ground floor", layout: null, table_count: 2, from_hourly_paise: 15000 })
    ]);

    const published = await as(manager)((tx) => partnerPublishLayout(tx, zone.id, draft.version as number));
    expect(published).toMatchObject({ status: "PUBLISHED", layout_version: 1 });
    const seating = await asAnon(sql, (tx) => venueSeating(tx, venue.venueId));
    const shown = (seating.zones as { name: string; layout: { elements: Record<string, unknown>[] } }[])[0]!;
    expect(shown.layout.elements).toHaveLength(3);
    expect(shown.layout.elements[0]).toMatchObject({
      type: "TABLE", resource_id: venue.tableIds[0], table: { capacity: 2, shape: "SQUARE", bookable: true, hourly_paise: 15000, photo: null }
    });
    expect(seating.unzoned_table_count).toBe(1);

    await expectDomainError(as(staff)((tx) => partnerSeating(tx, venue.venueId)), "FORBIDDEN");
    const editor = await as(manager)((tx) => partnerSeating(tx, venue.venueId));
    expect((editor.zones as Record<string, unknown>[])[0]).toMatchObject({ published_layout: { layout_version: 1 }, draft_layout: null });
  });

  it("refuses an invalid drawing whole and lists every problem", async () => {
    const zone = await zoneWithTables("Mezzanine", [venue.tableIds[2]!]);
    const problems = await expectDomainError(as(manager)((tx) => partnerSaveLayoutDraft(tx, zone.id, {
      width: 300, height: 200, expected_version: null,
      elements: [
        table(venue.tableIds[2]!, 10, 10, 100, 60),
        table(venue.tableIds[2]!, 150, 10, 100, 60), // same table twice
        table(venue.tableIds[0]!, 150, 100), // belongs to another area
        { type: "COUNTER", x: 250, y: 150, width: 100, height: 60 } // outside the canvas
      ]
    })), "VALIDATION_FAILED");
    expect((problems.problems as { code: string }[]).map((p) => p.code).sort()).toEqual(["duplicate_table", "outside_canvas", "table_in_other_area"]);

    // Overlapping tables (rotation swaps width and height).
    await sql`insert into public.resources (venue_id, label, capacity, zone_id) values (${venue.venueId}::uuid, 'Overlap test', 2, ${zone.id}::uuid)`;
    const extra = (await sql`select id from public.resources where venue_id = ${venue.venueId}::uuid and label = 'Overlap test'`)[0]!.id as string;
    const overlap = await expectDomainError(as(manager)((tx) => partnerSaveLayoutDraft(tx, zone.id, {
      width: 300, height: 200, expected_version: null,
      elements: [table(venue.tableIds[2]!, 10, 10, 120, 40), { ...table(extra, 60, 0, 120, 40), rotation: 90 }]
    })), "VALIDATION_FAILED");
    expect(overlap.problems).toEqual([expect.objectContaining({ index: 1, code: "overlaps_table" })]);
    await sql`update public.resources set status = 'RETIRED', zone_id = null where id = ${extra}::uuid`;

    // A valid draft; saving again needs its current version.
    const draft = await as(manager)((tx) => partnerSaveLayoutDraft(tx, zone.id, {
      width: 300, height: 200, expected_version: null, elements: [table(venue.tableIds[2]!, 10, 10, 120, 60)]
    }));
    await expectDomainError(as(manager)((tx) => partnerSaveLayoutDraft(tx, zone.id, {
      width: 300, height: 200, expected_version: null, elements: []
    })), "STALE_VERSION");
    const emptied = await as(manager)((tx) => partnerSaveLayoutDraft(tx, zone.id, {
      width: 300, height: 200, expected_version: draft.version as number, elements: []
    }));
    const noTables = await expectDomainError(as(manager)((tx) => partnerPublishLayout(tx, zone.id, emptied.version as number)), "VALIDATION_FAILED");
    expect(noTables).toMatchObject({ reason: "no_tables" });
  });

  it("freezes published drawings and archives the previous version on republish", async () => {
    const zone = (await sql`select id from public.venue_zones where venue_id = ${venue.venueId}::uuid and name = 'Ground floor'`)[0]!.id as string;
    const layout = (await sql`select id from public.floor_layouts where zone_id = ${zone}::uuid and status = 'PUBLISHED'`)[0]!.id as string;
    await expect(sql`update public.floor_layouts set width = 999 where id = ${layout}::uuid`).rejects.toThrow(/IMMUTABLE_RECORD/);
    await expect(sql`update public.layout_elements set x = 1 where layout_id = ${layout}::uuid`).rejects.toThrow(/IMMUTABLE_RECORD/);
    await expect(sql`delete from public.floor_layouts where id = ${layout}::uuid`).rejects.toThrow(/IMMUTABLE_RECORD/);

    // A table on a drawing cannot change area until the drawing no longer shows it.
    const mezzanine = (await sql`select id from public.venue_zones where venue_id = ${venue.venueId}::uuid and name = 'Mezzanine'`)[0]!.id as string;
    const moved = await expectDomainError(as(manager)(async (tx) =>
      partnerSetTableDetails(tx, venue.tableIds[1]!, { zone_id: mezzanine, expected_version: await resourceVersion(venue.tableIds[1]!) })), "INVALID_TRANSITION");
    expect(moved).toMatchObject({ reason: "table_on_floor_plan" });

    const v2 = await as(manager)((tx) => partnerSaveLayoutDraft(tx, zone, {
      width: 400, height: 300, expected_version: null, elements: [table(venue.tableIds[0]!, 40, 40), table(venue.tableIds[1]!, 200, 40)]
    }));
    expect(v2).toMatchObject({ status: "DRAFT", layout_version: 2 });
    await as(manager)((tx) => partnerPublishLayout(tx, zone, v2.version as number));
    const versions = await sql`select layout_version, status from public.floor_layouts where zone_id = ${zone}::uuid order by layout_version`;
    expect(versions.map((r) => `${r.layout_version}:${r.status}`)).toEqual(["1:ARCHIVED", "2:PUBLISHED"]);
    const audit = await sql`select action from public.audit_events where venue_id = ${venue.venueId}::uuid and action like 'layout.%'`;
    expect(audit.filter((a) => a.action === "layout.publish")).toHaveLength(2);
  });
});

describe("area prices and the seat map", () => {
  it("re-prices an area's tables from now, keeps custom prices and never changes a booking already made", async () => {
    const zone = (await sql`select id, version from public.venue_zones where venue_id = ${venue.venueId}::uuid and name = 'Ground floor'`)[0]!;
    const start = istSlot(3, "11:00");
    const held = await holdTable(sql, customer, venue, start, { table: 1, party: 2 });
    const heldTotal = held.quote.price_snapshot.total_paise;

    const first = await as(manager)((tx) => partnerSetZonePrice(tx, zone.id as string, {
      hourly_paise: 20000, keep_custom_prices: true, expected_version: Number(zone.version)
    }));
    expect((first.updated as { unchanged: boolean }[]).filter((u) => !u.unchanged)).toHaveLength(2);

    // Give table 1 its own price; the next area change keeps it.
    await sql`update public.resource_rates set effective_to = now() where resource_id = ${venue.tableIds[0]!}::uuid and effective_to is null`;
    await sql`insert into public.resource_rates (resource_id, rate_version, hourly_paise, effective_from, fee_config_version)
              values (${venue.tableIds[0]!}::uuid, 99, 18000, now(), 'SANDBOX-ZERO-2026-10')`;
    const zoneNow = (await sql`select version from public.venue_zones where id = ${zone.id}::uuid`)[0]!;
    const second = await as(manager)((tx) => partnerSetZonePrice(tx, zone.id as string, {
      hourly_paise: 22000, keep_custom_prices: true, expected_version: Number(zoneNow.version)
    }));
    expect(second.kept_custom).toEqual([expect.objectContaining({ resource_id: venue.tableIds[0], hourly_paise: 18000 })]);
    await expectDomainError(as(stranger)((tx) => partnerSetZonePrice(tx, zone.id as string, {
      hourly_paise: 100, keep_custom_prices: true, expected_version: 1
    })), "NOT_FOUND");

    const booking = await sql`select total_paise from public.bookings where id = ${held.booking_id}::uuid`;
    expect(Number(booking[0]!.total_paise)).toBe(heldTotal);
    const seating = await asAnon(sql, (tx) => venueSeating(tx, venue.venueId));
    expect((seating.zones as { name: string; from_hourly_paise: number }[]).find((z) => z.name === "Ground floor")!.from_hourly_paise).toBe(18000);
  });

  it("shows each table as free, booked or too small for one time and party", async () => {
    const start = istSlot(3, "11:00"); // table 1 is held at this time by the previous test
    const map = await asAnon(sql, (tx) => venueSeatMap(tx, venue.venueId, start, 60, 3));
    const state = Object.fromEntries((map.tables as { resource_id: string; state: string }[]).map((t) => [t.resource_id, t.state]));
    expect(state[venue.tableIds[0]!]).toBe("TOO_SMALL");
    expect(state[venue.tableIds[1]!]).toBe("BOOKED");
    expect(state[venue.tableIds[2]!]).toBe("FREE");
    const later = await asAnon(sql, (tx) => venueSeatMap(tx, venue.venueId, istSlot(3, "15:00"), 60, 2));
    const t1 = (later.tables as { resource_id: string; state: string; price: { hourly_paise: number } }[]).find((t) => t.resource_id === venue.tableIds[1]);
    expect(t1).toMatchObject({ state: "FREE", price: { hourly_paise: 22000 } });
    await expectDomainError(asAnon(sql, (tx) => venueSeatMap(tx, venue.venueId, start, 45, 2)), "VALIDATION_FAILED");
  });

  it("archives only an empty area", async () => {
    const zone = (await sql`select id, version from public.venue_zones where venue_id = ${venue.venueId}::uuid and name = 'Mezzanine'`)[0]!;
    const refused = await expectDomainError(as(manager)((tx) => partnerArchiveZone(tx, zone.id as string, Number(zone.version))), "INVALID_TRANSITION");
    expect(refused).toMatchObject({ reason: "area_has_tables" });
    await as(manager)(async (tx) => partnerSetTableDetails(tx, venue.tableIds[2]!, { zone_id: null, expected_version: await resourceVersion(venue.tableIds[2]!) }));
    const renamed = await as(manager)((tx) => partnerUpdateZone(tx, zone.id as string, { name: "Old mezzanine", expected_version: Number(zone.version) }));
    const archived = await as(manager)((tx) => partnerArchiveZone(tx, zone.id as string, renamed.version as number));
    expect(archived).toMatchObject({ status: "ARCHIVED" });
    expect((await sql`select count(*)::int as n from public.floor_layouts where zone_id = ${zone.id}::uuid and status = 'DRAFT'`)[0]!.n).toBe(0);
  });
});

describe("busy-hour pricing (phase 5)", () => {
  let busy: TestVenue;
  let zoneId: string;
  const quote = (table: number, start: string) => asUser(sql, claimsFor(customer), (tx) =>
    createQuote(tx, { venue_id: busy.venueId, resource_id: busy.tableIds[table]!, start_at: start, duration_minutes: 60, party_size: 2 }));

  beforeAll(async () => {
    busy = await createVenue(sql, { tables: [{ capacity: 4, hourlyPaise: 20000 }, { capacity: 4, hourlyPaise: 20000 }] });
    await grantVenueRole(sql, busy.venueId, manager, "MANAGER");
    await grantVenueRole(sql, busy.venueId, staff, "STAFF");
    const zone = await as(manager)((tx) => partnerCreateZone(tx, busy.venueId, { name: "Terrace", kind: "OUTDOOR" }));
    zoneId = zone.id as string;
    await as(manager)(async (tx) => partnerSetTableDetails(tx, busy.tableIds[0]!, { zone_id: zoneId, expected_version: await resourceVersion(busy.tableIds[0]!) }));
  });

  it("validates rules and lets only managers add them", async () => {
    const every = [0, 1, 2, 3, 4, 5, 6];
    await expectDomainError(as(staff)((tx) => partnerCreateRateRule(tx, busy.venueId, {
      label: "Evenings", weekdays: every, starts_local: "18:00", ends_local: "22:00", adjustment_bps: 2000 })), "FORBIDDEN");
    // An end before the start is an overnight window now; an empty window is refused.
    const empty = await expectDomainError(as(manager)((tx) => partnerCreateRateRule(tx, busy.venueId, {
      label: "Empty", weekdays: every, starts_local: "18:00", ends_local: "18:00", adjustment_bps: 2000 })), "VALIDATION_FAILED");
    expect(empty).toMatchObject({ field: "time", reason: "empty_window" });
    await expectDomainError(as(manager)((tx) => partnerCreateRateRule(tx, busy.venueId, {
      label: "Bad time", weekdays: every, starts_local: "25:00", ends_local: "18:00", adjustment_bps: 2000 })), "VALIDATION_FAILED");
    await expectDomainError(as(manager)((tx) => partnerCreateRateRule(tx, busy.venueId, {
      label: "No change", weekdays: every, starts_local: "18:00", ends_local: "22:00", adjustment_bps: 0 })), "VALIDATION_FAILED");
    await expectDomainError(as(manager)((tx) => partnerCreateRateRule(tx, busy.venueId, {
      label: "Too much", weekdays: every, starts_local: "18:00", ends_local: "22:00", adjustment_bps: 20000 })), "VALIDATION_FAILED");
  });

  it("prices quotes inside the window, lets an area rule win, and never changes a booking already made", async () => {
    const every = [0, 1, 2, 3, 4, 5, 6];
    const evenings = await as(manager)((tx) => partnerCreateRateRule(tx, busy.venueId, {
      label: "Evenings", weekdays: every, starts_local: "18:00", ends_local: "22:00", adjustment_bps: 2000 }));
    expect(evenings).toMatchObject({ label: "Evenings", weekdays: every, starts_local: "18:00", ends_local: "22:00", adjustment_bps: 2000, status: "ACTIVE" });
    await expect(sql`update public.rate_rules set adjustment_bps = 5000 where id = ${evenings.id as string}::uuid`).rejects.toThrow(/IMMUTABLE_RECORD/);

    // Venue-wide +20% from 18:00; nothing at 11:00.
    const evening = await quote(1, istSlot(4, "19:00"));
    expect(evening.price_snapshot).toMatchObject({ base_paise: 24000, base_before_busy_paise: 20000,
      busy_rules: [{ id: evenings.id, adjustment_bps: 2000, minutes: 60 }] });
    // The partner's rule name is not copied into what guests receive.
    expect(JSON.stringify(evening.price_snapshot)).not.toContain("Evenings");
    const morning = await quote(1, istSlot(4, "11:00"));
    expect(morning.price_snapshot).toMatchObject({ base_paise: 20000, busy_rules: [] });
    // Starting before the window: only the 30 minutes inside it are adjusted (20000 x (30 x 1.2 + 30) / 60 = 22000).
    expect((await quote(1, istSlot(4, "17:30"))).price_snapshot).toMatchObject({ base_paise: 22000, busy_rules: [{ adjustment_bps: 2000, minutes: 30 }] });

    // An area rule beats the venue rule for tables in that area (here a terrace discount).
    await as(manager)((tx) => partnerCreateRateRule(tx, busy.venueId, {
      zone_id: zoneId, label: "Terrace happy hour", weekdays: every, starts_local: "18:00", ends_local: "20:00", adjustment_bps: -1000 }));
    expect((await quote(0, istSlot(4, "19:00"))).price_snapshot).toMatchObject({ base_paise: 18000, busy_rules: [{ adjustment_bps: -1000, minutes: 60 }] });
    expect((await quote(0, istSlot(4, "20:30"))).price_snapshot).toMatchObject({ base_paise: 24000, busy_rules: [{ adjustment_bps: 2000, minutes: 60 }] });
    // Across the area rule's end: 30 min at -10%, then 30 min at +20% (20000 x (30 x 0.9 + 30 x 1.2) / 60 = 21000).
    expect((await quote(0, istSlot(4, "19:30"))).price_snapshot).toMatchObject({ base_paise: 21000,
      busy_rules: [{ adjustment_bps: -1000, minutes: 30 }, { adjustment_bps: 2000, minutes: 30 }] });

    // The day list shows the plain table price and says busy-hour prices exist.
    const day = await asAnon(sql, (tx) => venueDayAvailability(tx, busy.venueId, istSlot(4, "12:00").slice(0, 10), 60, 2));
    expect(day.has_busy_pricing).toBe(true);
    expect((day.tables as { price: { base_paise: number } }[]).map((t) => t.price.base_paise)).toEqual([20000, 20000]);

    // The seat map shows the same server price.
    const map = await asAnon(sql, (tx) => venueSeatMap(tx, busy.venueId, istSlot(4, "19:00"), 60, 2));
    const prices = Object.fromEntries((map.tables as { resource_id: string; price: { base_paise: number } }[]).map((t) => [t.resource_id, t.price.base_paise]));
    expect(prices).toEqual({ [busy.tableIds[0]!]: 18000, [busy.tableIds[1]!]: 24000 });

    // A hold made under the rule keeps its price after the rule is archived.
    const held = await holdTable(sql, customer, busy, istSlot(5, "19:00"), { table: 1 });
    const heldTotal = held.quote.price_snapshot.total_paise;
    await expectDomainError(as(staff)((tx) => partnerArchiveRateRule(tx, evenings.id as string)), "FORBIDDEN");
    expect(await as(manager)((tx) => partnerArchiveRateRule(tx, evenings.id as string))).toMatchObject({ status: "ARCHIVED" });
    expect(Number((await sql`select total_paise from public.bookings where id = ${held.booking_id}::uuid`)[0]!.total_paise)).toBe(heldTotal);
    expect((await sql`select price_snapshot -> 'busy_rules' -> 0 ->> 'id' as id from public.bookings where id = ${held.booking_id}::uuid`)[0]!.id).toBe(evenings.id);
    expect((await quote(1, istSlot(4, "20:30"))).price_snapshot).toMatchObject({ base_paise: 20000, busy_rules: [] });
    const audit = await sql`select action from public.audit_events where venue_id = ${busy.venueId}::uuid and action like 'rate_rule.%' order by created_at`;
    expect(audit.map((a) => a.action)).toEqual(["rate_rule.create", "rate_rule.create", "rate_rule.archive"]);
  });

  it("supports windows across midnight and 'until midnight', and archives an area's rules with the area", async () => {
    // An overnight window that starts the day before applies in the early morning of the next day.
    const morningSlot = istSlot(6, "08:30");
    const dayBefore = (new Date(Date.parse(morningSlot) + 330 * 60_000).getUTCDay() + 6) % 7;
    const night = await as(manager)((tx) => partnerCreateRateRule(tx, busy.venueId, {
      label: "Night owls", weekdays: [dayBefore], starts_local: "20:00", ends_local: "09:00", adjustment_bps: 5000 }));
    expect(night).toMatchObject({ starts_local: "20:00", ends_local: "09:00", overnight: true });
    // 08:30-09:30: 30 min inside the tail (+50%), 30 min after it (20000 x (30 x 1.5 + 30) / 60 = 25000).
    expect((await quote(1, morningSlot)).price_snapshot).toMatchObject({ base_paise: 25000, busy_rules: [{ adjustment_bps: 5000, minutes: 30 }] });
    await as(manager)((tx) => partnerArchiveRateRule(tx, night.id as string));

    const late = await as(manager)((tx) => partnerCreateRateRule(tx, busy.venueId, {
      label: "Late", weekdays: [0, 1, 2, 3, 4, 5, 6], starts_local: "21:00", ends_local: "24:00", adjustment_bps: 1000 }));
    expect(late).toMatchObject({ ends_local: "24:00", overnight: false });
    await expectDomainError(as(manager)((tx) => partnerCreateRateRule(tx, busy.venueId, {
      label: "Empty", weekdays: [1], starts_local: "18:00", ends_local: "18:00", adjustment_bps: 1000 })), "VALIDATION_FAILED");
    await as(manager)((tx) => partnerArchiveRateRule(tx, late.id as string));

    // Archiving an area archives its rules.
    const patio = await as(manager)((tx) => partnerCreateZone(tx, busy.venueId, { name: "Patio" }));
    const patioRule = await as(manager)((tx) => partnerCreateRateRule(tx, busy.venueId, {
      zone_id: patio.id as string, label: "Patio sun", weekdays: [0], starts_local: "12:00", ends_local: "15:00", adjustment_bps: 1000 }));
    await as(manager)((tx) => partnerArchiveZone(tx, patio.id as string, patio.version as number));
    expect((await sql`select status from public.rate_rules where id = ${patioRule.id as string}::uuid`)[0]!.status).toBe("ARCHIVED");
    const listed = (await as(manager)((tx) => partnerSeating(tx, busy.venueId))).rate_rules as { id: string }[];
    expect(listed.map((r) => r.id)).not.toContain(patioRule.id);
  });
});
