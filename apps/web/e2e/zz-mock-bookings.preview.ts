// TEMPORARY mock-data script (delete after use): creates confirmed bookings at the mock venue "The Verandah House"
// through the real quote -> hold -> mock gateway payment flow (no direct inserts), so partner and admin dashboards
// have fictional activity. Customers are fresh fictional @example.test accounts.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createFixtureUser, payOnMockGateway, signInWithEmailCode } from "./helpers";

const VERANDAH = "22222222-2222-4222-8222-000000000101";
const TABLES = ["33333333-3333-4333-8333-000000001011", "33333333-3333-4333-8333-000000001012", "33333333-3333-4333-8333-000000001013"];
const ORIGIN = "http://localhost:3000";

// Next starts on the 30-minute grid, at least 20 minutes away, ending by 22:00 IST (venue hours 08:00-22:00).
function slots(count: number): string[] {
  const out: string[] = [];
  const nowIstMin = Math.floor((Date.now() + 330 * 60_000) / 60_000);
  let start = Math.ceil((nowIstMin + 20) / 30) * 30;
  while (out.length < count) {
    const minuteOfDay = ((start % 1440) + 1440) % 1440;
    if (minuteOfDay < 8 * 60) start += 8 * 60 - minuteOfDay;
    else if (minuteOfDay + 60 > 22 * 60) start += 1440 - minuteOfDay + 8 * 60;
    else {
      out.push(new Date((start - 330) * 60_000).toISOString());
      start += 60;
    }
  }
  return out;
}

test("mock bookings at The Verandah House", async ({ browser }) => {
  const starts = slots(5);
  for (const [i, startAt] of starts.entries()) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const customer = await createFixtureUser();
    await page.goto("/sign-in?redirect_path=/bookings");
    await signInWithEmailCode(page, customer.email);
    await expect(page.getByRole("heading", { name: "Your good hours, in one place." })).toBeVisible();
    const post = (path: string, data: unknown, extra: Record<string, string> = {}) =>
      page.request.post(path, { data, headers: { origin: ORIGIN, ...extra } });
    const quote = await post("/api/v1/quotes", {
      venue_id: VERANDAH, resource_id: TABLES[i % TABLES.length], start_at: startAt, duration_minutes: 60, party_size: 2
    });
    expect(quote.status()).toBe(201);
    const q = (await quote.json()).data as { quote_id: string; policy_hash: string; price_snapshot: { total_paise: number } };
    const hold = await post("/api/v1/booking-holds",
      { quote_id: q.quote_id, accepted_policy_hash: q.policy_hash, expected_quote_total_paise: q.price_snapshot.total_paise },
      { "idempotency-key": randomUUID() });
    expect(hold.status()).toBe(201);
    const booking = (await hold.json()).data as { booking_id: string; public_ref: string };
    await page.goto(`/checkout/${booking.booking_id}`);
    await payOnMockGateway(page, "mock-pay-success", "now");
    // The return page verifies the payment with the server; wait for it before closing the browser.
    await expect(page.getByTestId("payment-title")).toHaveText("Booking confirmed");
    console.info(`booked ${booking.public_ref} at ${startAt}`);
    await context.close();
  }
});
