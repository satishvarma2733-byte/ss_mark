// M4.2 extension journey in real browsers against the local stack and the mock provider: a checked-in customer asks
// for more time, staff approve on the arrivals desk, the customer holds and pays, and the booking's end moves only after
// the verified payment. Fictional data only.
import { expect, test } from "@playwright/test";
import {
  apiPost, createFixtureUser, createQuickVenue, db, evidence, holdThroughApi, payOnMockGateway, signInWithMfa, signedInCustomer
} from "./helpers";

test("a checked-in customer extends: request -> staff approve -> hold -> pay -> new end time", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const venue = await createQuickVenue({ tables: 1, overnight: true });
  await signedInCustomer(page);
  const hold = await holdThroughApi(page, venue, 0, 1);
  await page.goto(`/checkout/${hold.booking_id}`);
  await payOnMockGateway(page, "mock-pay-success");
  await expect(page.getByTestId("payment-title")).toHaveText("Booking confirmed");
  await page.goto(`/bookings/${hold.booking_id}`);
  const pin = (await page.getByTestId("arrival-pin").textContent())!.trim();
  // Before check-in, more time cannot be requested.
  const early = await apiPost(page, `/api/v1/bookings/${hold.booking_id}/extension-requests`, { additional_minutes: 30, expected_version: 3 },
    { "idempotency-key": crypto.randomUUID() });
  expect(early.status).toBe(409);

  const staff = await createFixtureUser({ venueRole: { venueId: venue.venueId, role: "STAFF" } });
  const staffContext = await browser.newContext();
  const desk = await staffContext.newPage();
  await signInWithMfa(desk, staff.email, `/staff?venue=${venue.venueId}`);
  await desk.getByLabel("Booking reference").fill(hold.public_ref);
  await desk.getByLabel("PIN", { exact: true }).fill(pin);
  await desk.getByTestId("check-in-pin").click();
  await expect(desk.getByTestId("check-in-result")).toContainText(`Checked in: ${hold.public_ref}`);

  const [before] = await db()`select end_at from public.bookings where id = ${hold.booking_id}::uuid`;
  await page.goto(`/bookings/${hold.booking_id}`);
  await page.getByTestId("extend-link").click();
  await page.getByTestId("ext-minutes").getByRole("radio", { name: /^\+30 min/ }).check();
  await page.getByRole("checkbox", { name: /verified payment/ }).check();
  await page.getByTestId("ext-request").click();
  await expect(page.getByTestId("ext-requested")).toBeVisible();
  await evidence(page, "web-m42-01-requested");

  // The desk polls every 10 seconds; staff approve within the five-minute window.
  await desk.reload();
  await expect(desk.getByTestId("staff-extensions")).toContainText(hold.public_ref, { timeout: 20_000 });
  await evidence(desk, "web-m42-02-staff-desk");
  await desk.getByTestId(`ext-approve-${hold.public_ref}`).click();
  await expect(desk.getByTestId("staff-extensions")).toContainText("waiting for the guest to pay", { timeout: 20_000 });

  await expect(page.getByTestId("ext-approved")).toBeVisible({ timeout: 15_000 });
  await evidence(page, "web-m42-03-approved");
  await page.getByTestId("ext-pay").click();
  await expect(page.getByText("MOCK PAYMENT GATEWAY - TEST MODE")).toBeVisible();
  await page.locator('input[name="webhook"][value="none"]').check();
  await page.getByTestId("mock-pay-success").click();
  await expect(page.getByTestId("payment-title")).toHaveText("Extension confirmed");
  await evidence(page, "web-m42-04-confirmed");

  const [after] = await db()`select end_at from public.bookings where id = ${hold.booking_id}::uuid`;
  expect((after!.end_at as Date).getTime() - (before!.end_at as Date).getTime()).toBe(30 * 60_000);
  await page.goto(`/bookings/${hold.booking_id}`);
  await expect(page.getByTestId("extension-line")).toContainText("Extra 30 minutes");
  await staffContext.close();
});
