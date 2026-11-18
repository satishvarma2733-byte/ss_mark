// M3 customer web journey and staff arrival in a real browser against the local stack and the mock payment provider.
// These use the server-verify path (the return page asks the server, which fetches the payment from the provider), so
// no background worker is needed; webhook processing is covered by tests/integration/payments.test.ts.
import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  apiPost, createFixtureUser, createQuickVenue, db, holdThroughApi, makeHoldDue, nextQuickSlot, payOnMockGateway, signInWithEmailCode,
  signInWithMfa, signedInCustomer
} from "./helpers";

test("search to verified confirmation to staff check-in, check-out and table ready", async ({ page, browser }) => {
  const venue = await createQuickVenue();
  const staff = await createFixtureUser({ venueRole: { venueId: venue.venueId, role: "STAFF" } });

  // C03 -> C04: manual area search (no location permission), venue rules before any selection.
  await page.goto("/venues?area=koramangala");
  // Many fixture cafes from earlier runs share this area and distance, so this test's cafe may not be on the first page.
  // The search itself is checked here; this test's own venue is then opened by its slug.
  await expect(page.getByTestId("venue-card").first()).toBeVisible();
  await page.goto(`/venues/${venue.slug}`);
  await expect(page.getByText("E2E: outside food allowed.")).toBeVisible();
  await expect(page.getByText("Outside food: Allowed")).toBeVisible();
  await page.getByTestId("table-slots").first().locator("a.slot").first().click();

  // C05 requires sign-in, then comes back to the same selection.
  const customer = await createFixtureUser();
  await signInWithEmailCode(page, customer.email);
  await expect(page.getByRole("heading", { name: "Choose your table." })).toBeVisible();
  await expect(page.getByTestId("quote-total")).toHaveText("₹300.00");
  await expect(page.getByTestId("hold-table")).toBeDisabled();
  await page.getByTestId("accept-rules").check();
  await page.getByTestId("hold-table").click();

  // C06 -> provider -> C07: confirmation only after the server's verification.
  await expect(page.getByTestId("hold-countdown")).toBeVisible();
  await payOnMockGateway(page, "mock-pay-success");
  await expect(page.getByTestId("payment-title")).toHaveText("Booking confirmed");
  await page.getByRole("link", { name: "View booking and check-in code" }).click();
  await expect(page.getByTestId("booking-status")).toHaveText("Confirmed");
  const pin = (await page.getByTestId("arrival-pin").textContent())!.trim();
  const ref = (await page.getByTestId("booking-ref").textContent())!.trim();
  await expect(page.locator(".arrival svg")).toBeVisible();

  // P06: assigned staff with MFA checks the guest in by reference + PIN.
  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  await signInWithMfa(staffPage, staff.email, `/staff?venue=${venue.venueId}`);
  await expect(staffPage.getByRole("heading", { name: "Staff arrivals" })).toBeVisible();
  await staffPage.getByLabel("Booking reference").fill(ref);
  await staffPage.getByLabel("PIN", { exact: true }).fill(pin === "000000" ? "111111" : "000000");
  await staffPage.getByTestId("check-in-pin").click();
  await expect(staffPage.getByTestId("check-in-result")).toHaveText("That code did not match a booking for this venue.");
  await staffPage.getByLabel("Booking reference").fill(ref);
  await staffPage.getByLabel("PIN", { exact: true }).fill(pin);
  await staffPage.getByTestId("check-in-pin").click();
  await expect(staffPage.getByTestId("check-in-result")).toContainText(`Checked in: ${ref}`);
  // The confirmation panel repeats the booking, table and party from the server's answer.
  await expect(staffPage.getByTestId("arrival-confirmed")).toContainText("Guest checked in");
  await expect(staffPage.getByTestId("arrival-confirmed")).toContainText(ref);

  await page.reload();
  await expect(page.getByTestId("booking-status")).toHaveText("Checked in");

  await staffPage.getByTestId(`check-out-${ref}`).click();
  await expect(staffPage.getByTestId("check-in-result")).toContainText("marked for cleaning");
  await staffPage.getByTestId("ready-Quick table 1").click();
  await expect(staffPage.getByTestId("table-Quick table 1")).toContainText("Ready");
  await page.reload();
  await expect(page.getByTestId("booking-status")).toHaveText("Completed");
  await staffContext.close();
});

test("a declined payment can be retried while the hold lasts; both attempts are kept", async ({ page }) => {
  const venue = await createQuickVenue();
  await signedInCustomer(page);
  const hold = await holdThroughApi(page, venue);
  await page.goto(`/checkout/${hold.booking_id}`);

  await payOnMockGateway(page, "mock-pay-fail");
  await expect(page.getByTestId("payment-title")).toHaveText("Payment failed");
  await page.getByRole("link", { name: "Try paying again" }).click();
  await expect(page.getByText("The last payment attempt failed")).toBeVisible();
  await payOnMockGateway(page, "mock-pay-success");
  await expect(page.getByTestId("payment-title")).toHaveText("Booking confirmed");

  const attempts = await db()`select state from public.payment_attempts where booking_id = ${hold.booking_id}::uuid order by created_at`;
  expect(attempts.map((a) => a.state)).toEqual(["FAILED", "CAPTURED"]);
});

test("an authorized-only payment stays pending until the provider captures it", async ({ page, context }) => {
  const venue = await createQuickVenue();
  await signedInCustomer(page);
  const hold = await holdThroughApi(page, venue);
  await page.goto(`/checkout/${hold.booking_id}`);
  await payOnMockGateway(page, "mock-pay-authorize");
  await expect(page.getByTestId("payment-title")).toHaveText("Verifying payment...");
  await expect(page.getByTestId("payment-title")).not.toHaveText("Booking confirmed", { timeout: 4000 });

  // The provider settles the payment later (console = provider side). The return page's server check confirms it.
  const consolePage = await context.newPage();
  await consolePage.goto("/mock-gateway/console");
  const [order] = await db()`select provider_order_id from public.payment_orders where booking_id = ${hold.booking_id}::uuid`;
  const [payment] = await db()`select id from mock_gateway.payments where order_id = ${order!.provider_order_id as string}`;
  await consolePage.getByTestId(`mock-capture-${payment!.id as string}`).click();
  await consolePage.close();

  await expect(page.getByTestId("payment-title")).toHaveText("Booking confirmed", { timeout: 20_000 });
});

test("a capture after the hold expired never confirms: the table is released and a full refund is pending", async ({ page, context }) => {
  const venue = await createQuickVenue();
  await signedInCustomer(page);
  const hold = await holdThroughApi(page, venue);
  await page.goto(`/checkout/${hold.booking_id}`);
  await payOnMockGateway(page, "mock-pay-authorize");
  await expect(page.getByTestId("payment-title")).toHaveText("Verifying payment...");

  await makeHoldDue(hold.booking_id);
  const consolePage = await context.newPage();
  await consolePage.goto("/mock-gateway/console");
  const [order] = await db()`select provider_order_id from public.payment_orders where booking_id = ${hold.booking_id}::uuid`;
  const [payment] = await db()`select id from mock_gateway.payments where order_id = ${order!.provider_order_id as string}`;
  await consolePage.getByTestId(`mock-capture-${payment!.id as string}`).click();
  await consolePage.close();

  await expect(page.getByTestId("payment-title")).toHaveText(/Refund (pending|processed)/, { timeout: 20_000 });
  await expect(page.getByTestId("payment-status")).toContainText("₹300.00");
  const [booking] = await db()`select status from public.bookings where id = ${hold.booking_id}::uuid`;
  expect(booking!.status).toBe("EXPIRED");
  const [claim] = await db()`select active from public.inventory_claims where booking_id = ${hold.booking_id}::uuid`;
  expect(claim!.active).toBe(false);

  await page.goto(`/checkout/${hold.booking_id}`);
  await expect(page.getByTestId("hold-ended")).toContainText("A full refund is pending");
});

test("a customer can release a held table, and another customer's booking is not found", async ({ page, browser }) => {
  const venue = await createQuickVenue();
  await signedInCustomer(page);
  const hold = await holdThroughApi(page, venue);
  await page.goto(`/checkout/${hold.booking_id}`);
  await page.getByTestId("cancel-hold").click();
  await expect(page.getByTestId("hold-ended")).toContainText("You released this table");

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signedInCustomer(otherPage);
  // The page streams behind the root loading boundary, so the not-found screen arrives with HTTP 200; it shows the
  // same screen as a missing ID and none of the booking. The API answers 404.
  await otherPage.goto(`/bookings/${hold.booking_id}`);
  await expect(otherPage.getByRole("heading", { name: "We could not find that page" })).toBeVisible();
  await expect(otherPage.getByText(hold.public_ref)).toHaveCount(0);
  const api = await otherPage.request.get(`/api/v1/bookings/${hold.booking_id}`);
  expect(api.status()).toBe(404);
  await other.close();
});

test("search: list and schematic map, availability-only filter, empty state and invalid input", async ({ page }) => {
  await page.goto("/venues?area=koramangala&view=map");
  await expect(page.getByRole("group", { name: "Illustrative area map of results" })).toBeVisible();
  await expect(page.getByText("Illustrative area map · Locations approximate")).toBeVisible();
  await expect(page.getByTestId("venue-card").first()).toBeVisible();

  await page.goto("/venues?area=koramangala&party=10");
  await expect(page.getByTestId("search-empty")).toBeVisible();

  const api = await page.request.get("/api/v1/venues?area=koramangala&environment_tags=NOISY");
  expect(api.status()).toBe(422);
  expect((await api.json()).error.code).toBe("VALIDATION_FAILED");
  const cursor = await page.request.get("/api/v1/venues?area=koramangala&cursor=bogus");
  expect(cursor.status()).toBe(400);
  expect((await cursor.json()).error.code).toBe("INVALID_CURSOR");
  const unpublished = await page.request.get("/api/v1/venues/22222222-2222-4222-8222-000000000008");
  expect(unpublished.status()).toBe(404);
});

test("webhooks: an unsigned or tampered event is rejected before anything is stored", async ({ request }) => {
  const body = JSON.stringify({ id: `evt_forged_${randomUUID().slice(0, 8)}`, event: "payment.captured", payload: { payment: { entity: { id: "pay_x", order_id: "order_x" } } } });
  const unsigned = await request.post("/api/v1/webhooks/mock", { data: body, headers: { "content-type": "application/json" } });
  expect(unsigned.status()).toBe(401);
  const forged = await request.post("/api/v1/webhooks/mock", { data: body, headers: { "content-type": "application/json", "x-mock-signature": "a".repeat(64) } });
  expect(forged.status()).toBe(401);
  const stored = await db()`select count(*)::int as n from public.provider_events where event_id = ${JSON.parse(body).id as string}`;
  expect(stored[0]!.n).toBe(0);
});

test("signed-in cookie requests from another origin are refused on every new mutation", async ({ page }) => {
  const venue = await createQuickVenue();
  await signedInCustomer(page);
  const hold = await holdThroughApi(page, venue);
  const foreign = { origin: "http://evil.example", "idempotency-key": randomUUID() };
  const attempts = [
    page.request.post(`/api/v1/bookings/${hold.booking_id}/checkout`, { data: { expected_version: 1 }, headers: foreign }),
    page.request.post(`/api/v1/bookings/${hold.booking_id}/cancel-hold`, { data: { expected_version: 1 }, headers: foreign }),
    page.request.post(`/api/v1/payment-orders/${randomUUID()}/verify`, { data: {}, headers: foreign }),
    page.request.post("/api/v1/partner/check-in", { data: { venue_id: venue.venueId, qr_token: "A".repeat(43) }, headers: foreign }),
    page.request.post(`/api/v1/partner/bookings/${hold.booking_id}/check-out`, { data: { expected_version: 1 }, headers: foreign })
  ];
  for (const response of await Promise.all(attempts)) {
    expect(response.status()).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
  }
  const [booking] = await db()`select status from public.bookings where id = ${hold.booking_id}::uuid`;
  expect(booking!.status).toBe("HOLD");
});

test("webhooks: oversized bodies and signed-but-malformed events are rejected before storage", async ({ request }) => {
  const oversized = await request.post("/api/v1/webhooks/mock", { data: "x".repeat(70 * 1024), headers: { "content-type": "application/json" } });
  expect(oversized.status()).toBe(400);
  const secret = process.env.MOCK_GATEWAY_WEBHOOK_SECRET;
  if (!secret) throw new Error("run pnpm env:local");
  const body = "{not json";
  const malformed = await request.post("/api/v1/webhooks/mock", {
    // Raw bytes: Playwright JSON-encodes a string body when the content type is JSON, which would change the signed bytes.
    data: Buffer.from(body, "utf8"),
    headers: { "content-type": "application/json", "x-mock-signature": createHmac("sha256", secret).update(body).digest("hex") }
  });
  expect(malformed.status()).toBe(400);
  expect((await malformed.json()).error.code).toBe("MALFORMED_REQUEST");
});

test("public availability and quotes show what the customer pays, not internal fee settings", async ({ page, request }) => {
  const venue = await createQuickVenue();
  const date = new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10);
  const availability = await request.get(`/api/v1/venues/${venue.venueId}/availability?date=${date}&duration_minutes=60&party_size=2`);
  expect(availability.status()).toBe(200);
  const price = (await availability.json()).data.tables[0].price;
  expect(price.total_paise).toBe(30000);
  for (const field of ["commission_bps", "platform_fixed_paise", "rounding_rule"]) expect(price).not.toHaveProperty(field);
  await signedInCustomer(page);
  const quote = await apiPost(page, "/api/v1/quotes", {
    venue_id: venue.venueId, resource_id: venue.tableIds[0], start_at: nextQuickSlot(30), duration_minutes: 60, party_size: 2
  });
  expect(quote.status).toBe(201);
  expect(quote.body.data!.price_snapshot).not.toHaveProperty("commission_bps");
});
