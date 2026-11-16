// Venue-local time rules on real PostgreSQL: IST conversion, 30-minute grid, lead/horizon, hours including the cleaning
// buffer, overnight periods and closed days (docs/02 s.4, docs/07 s.2 "Quote and hold checks").
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createQuote, type Sql } from "@simply-sit/db";
import { claimsFor, createUser, createVenue, expectDomainError, istDate, istInstant, istSlot, nextIstWeekday, openDb, type TestUser, type TestVenue } from "./helpers";

let sql: Sql;
let user: TestUser;
beforeAll(async () => {
  sql = openDb();
  user = await createUser(sql);
});
afterAll(async () => {
  await sql.end();
});

const quote = (venue: TestVenue, startAt: string, minutes = 60) =>
  asUser(sql, claimsFor(user), (tx) =>
    createQuote(tx, { venue_id: venue.venueId, resource_id: venue.tableIds[0]!, start_at: startAt, duration_minutes: minutes, party_size: 2 }));

describe("Asia/Kolkata boundaries", () => {
  let venue: TestVenue;
  beforeAll(async () => {
    venue = await createVenue(sql); // 08:00-22:00 every day
  });

  it("stores instants in UTC: 10:00 IST is 04:30Z", async () => {
    const q = await quote(venue, istSlot(2, "10:00"));
    expect(new Date(q.start_at).toISOString()).toBe(`${istDate(2)}T04:30:00.000Z`);
    expect(q.venue_timezone).toBe("Asia/Kolkata");
  });

  it("enforces the 30-minute grid in venue-local time", async () => {
    await expectDomainError(quote(venue, istSlot(2, "10:15")), "VALIDATION_FAILED");
    const ok = await quote(venue, istSlot(2, "10:30"));
    expect(ok.price_snapshot.total_paise).toBe(30000);
  });

  it("enforces minimum, maximum and increment durations", async () => {
    for (const minutes of [30, 75, 270]) {
      const details = await expectDomainError(quote(venue, istSlot(2, "12:00"), minutes), "VALIDATION_FAILED");
      expect(details.field).toBe("duration_minutes");
    }
  });

  it("requires the cleaning buffer to fit before closing time", async () => {
    // 21:00-22:00 + 10 minutes ends 22:10, after the 22:00 close.
    await expectDomainError(quote(venue, istSlot(2, "21:00")), "OUTSIDE_HOURS");
    // 20:30-21:30 + 10 minutes ends 21:40.
    const ok = await quote(venue, istSlot(2, "20:30"));
    expect(ok.quote_id).toBeTruthy();
    await expectDomainError(quote(venue, istSlot(2, "07:30")), "OUTSIDE_HOURS");
  });

  it("rejects starts beyond the 30-day horizon", async () => {
    const details = await expectDomainError(quote(venue, istSlot(31, "10:00")), "VALIDATION_FAILED");
    expect(details.reason).toBe("horizon");
  });

  it("rejects starts inside the lead time", async () => {
    const lead = await createVenue(sql, { policy: { lead_minutes: 3 * 24 * 60 } });
    const details = await expectDomainError(quote(lead, istSlot(2, "10:00")), "VALIDATION_FAILED");
    expect(details.reason).toBe("lead_time");
  });
});

describe("overnight and closed days", () => {
  it("accepts a booking that crosses midnight inside a 17:00-01:00 period, with its buffer", async () => {
    const brewery = await createVenue(sql, { hours: { weekdays: [0, 1, 2, 3, 4, 5, 6], opens: "17:00", closes: "01:00" } });
    const date = istDate(3);
    const q = await quote(brewery, istInstant(date, "23:30"));
    expect(new Date(q.end_at).getTime() - new Date(q.start_at).getTime()).toBe(60 * 60_000);
    // 00:00-01:00 on the next calendar day still belongs to the previous evening's period, but its buffer ends 01:10.
    const nextDay = istDate(4);
    await expectDomainError(quote(brewery, istInstant(nextDay, "00:00")), "OUTSIDE_HOURS");
    // 23:00-00:30 (90 min) + 10 = 00:40, inside.
    const ok = await quote(brewery, istInstant(date, "23:00"), 90);
    expect(ok.quote_id).toBeTruthy();
    await expectDomainError(quote(brewery, istInstant(date, "16:30")), "OUTSIDE_HOURS");
  });

  it("rejects a day with no opening period", async () => {
    const weekdaysOnly = await createVenue(sql, { hours: { weekdays: [1, 2, 3, 4, 5, 6], opens: "09:00", closes: "20:00" } });
    await expectDomainError(quote(weekdaysOnly, istInstant(nextIstWeekday(0), "10:00")), "OUTSIDE_HOURS");
    const monday = await quote(weekdaysOnly, istInstant(nextIstWeekday(1), "10:00"));
    expect(monday.quote_id).toBeTruthy();
  });

  it("rejects overlapping opening periods, including an overnight period wrapping into Sunday", async () => {
    const venue = await createVenue(sql, { hours: { weekdays: [6], opens: "18:00", closes: "02:00" } });
    await expect(
      sql`insert into public.opening_periods (venue_id, weekday, opens_local, closes_local, closes_next_day, schedule_version)
          values (${venue.venueId}::uuid, 0, '01:00', '05:00', false, 1)`
    ).rejects.toMatchObject({ message: "VALIDATION_FAILED" });
  });
});
