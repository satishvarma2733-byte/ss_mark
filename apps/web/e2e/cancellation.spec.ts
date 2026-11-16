// M4.1 cancellation in a real browser and over the API against the local stack and the mock payment provider.
// Refund processing by the worker is covered by tests/integration/cancellation.test.ts; here the refund stays
// "in progress", which is exactly what the customer must see until the provider confirms it.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  apiPost, bearer, createFixtureUser, createQuickVenue, db, holdThroughApi, nativeSignIn, payOnMockGateway, signedInCustomer,
  stepUpToAal2
} from "./helpers";

test("a customer cancels early with a full refund, and late with none; replays are idempotent", async ({ page, request }) => {
  const venue = await createQuickVenue({ tables: 2 });
  await signedInCustomer(page);

  // Early: starts 3 hours ahead, outside the 2-hour cutoff.
  const early = await holdThroughApi(page, venue, 0, 180);
  await page.goto(`/checkout/${early.booking_id}`);
  await payOnMockGateway(page, "mock-pay-success");
  await expect(page.getByTestId("payment-title")).toHaveText("Booking confirmed");
  await page.goto(`/bookings/${early.booking_id}`);
  await expect(page.getByTestId("arrival")).toBeVisible();
  await page.getByTestId("cancel-booking-link").click();

  await expect(page.getByRole("heading", { name: "Cancel booking" })).toBeVisible();
  await expect(page.getByText("Full refund if you cancel at least 2 hours before the start; no refund after that.")).toBeVisible();
  await expect(page.getByTestId("cancel-refund")).toHaveText("₹300.00");
  await page.getByLabel("Reason (optional)").selectOption("CHANGE_OF_PLANS");
  await page.getByTestId("confirm-cancel").click();

  await expect(page).toHaveURL(new RegExp(`/bookings/${early.booking_id}$`));
  await expect(page.getByTestId("booking-status")).toHaveText("Cancelled");
  await expect(page.getByTestId("cancelled-notice")).toHaveText("You cancelled this booking.");
  await expect(page.getByTestId("refund-line")).toHaveText("₹300.00 (you cancelled) - in progress, not yet confirmed by the payment provider");
  await expect(page.getByTestId("arrival")).toHaveCount(0);
  await expect(page.getByTestId("cancel-booking-link")).toHaveCount(0);
  // The cancel page now sends the customer back to the booking.
  await page.goto(`/bookings/${early.booking_id}/cancel`);
  await expect(page).toHaveURL(new RegExp(`/bookings/${early.booking_id}$`));

  // Late: starts within the hour, so the refund is zero; a stale "full refund" request is refused with the new terms.
  const late = await holdThroughApi(page, venue, 1, 30);
  await page.goto(`/checkout/${late.booking_id}`);
  await payOnMockGateway(page, "mock-pay-success");
  await expect(page.getByTestId("payment-title")).toHaveText("Booking confirmed");
  const [row] = await db()`select version, total_paise from public.bookings where id = ${late.booking_id}::uuid`;
  const stale = await apiPost(page, `/api/v1/bookings/${late.booking_id}/cancel`,
    { expected_version: row!.version, expected_refund_paise: Number(row!.total_paise) }, { "idempotency-key": randomUUID() });
  expect(stale.status).toBe(409);
  expect(stale.body.error?.code).toBe("CANCELLATION_CHANGED");

  await page.goto(`/bookings/${late.booking_id}/cancel`);
  await expect(page.getByTestId("cancel-no-refund")).toBeVisible();
  await expect(page.getByTestId("cancel-refund")).toHaveText("₹0.00");
  // Replaying the same confirmation (same Idempotency-Key and body) returns the original result, not a second cancel.
  const key = randomUUID();
  const body = { expected_version: row!.version, expected_refund_paise: 0 };
  const first = await apiPost(page, `/api/v1/bookings/${late.booking_id}/cancel`, body, { "idempotency-key": key });
  expect(first.status).toBe(200);
  expect(first.body.data).toMatchObject({ status: "CANCELLED", refund_paise: 0, refund_id: null });
  const replay = await apiPost(page, `/api/v1/bookings/${late.booking_id}/cancel`, body, { "idempotency-key": key });
  expect(replay.status).toBe(200);
  expect(replay.body.data).toEqual(first.body.data);
  const again = await apiPost(page, `/api/v1/bookings/${late.booking_id}/cancel`, body, { "idempotency-key": randomUUID() });
  expect(again.status).toBe(409);
  expect(again.body.error?.code).toBe("INVALID_TRANSITION");
  await page.goto(`/bookings/${late.booking_id}`);
  await expect(page.getByTestId("booking-status")).toHaveText("Cancelled");
  await expect(page.getByTestId("refund-line")).toHaveCount(0);

  // Another customer's booking is not found (bearer only: the page's request context would also send this customer's cookie).
  const outsider = await createFixtureUser();
  const { token } = await nativeSignIn(outsider.email);
  const foreign = await request.post(`/api/v1/bookings/${early.booking_id}/cancel-preview`, { headers: bearer(token) });
  expect(foreign.status()).toBe(404);
});

test("a venue manager with MFA can service-cancel with a full refund; staff cannot", async ({ page, request }) => {
  const venue = await createQuickVenue({ tables: 1 });
  await signedInCustomer(page);
  const hold = await holdThroughApi(page, venue, 0, 30);
  await page.goto(`/checkout/${hold.booking_id}`);
  await payOnMockGateway(page, "mock-pay-success");
  await expect(page.getByTestId("payment-title")).toHaveText("Booking confirmed");
  const [row] = await db()`select version, total_paise from public.bookings where id = ${hold.booking_id}::uuid`;
  const body = { reason_code: "TABLE_UNAVAILABLE", reason: "E2E: table damaged", expected_version: row!.version };

  const staff = await createFixtureUser({ venueRole: { venueId: venue.venueId, role: "STAFF" } });
  const staffSession = await nativeSignIn(staff.email);
  const staffAal2 = await stepUpToAal2(staffSession.client);
  const refused = await request.post(`/api/v1/bookings/${hold.booking_id}/service-cancel`, {
    headers: bearer(staffAal2, { "idempotency-key": randomUUID() }), data: body
  });
  expect(refused.status()).toBe(403);

  const manager = await createFixtureUser({ venueRole: { venueId: venue.venueId, role: "MANAGER" } });
  const managerSession = await nativeSignIn(manager.email);
  const aal1 = await request.post(`/api/v1/bookings/${hold.booking_id}/service-cancel`, {
    headers: bearer(managerSession.token, { "idempotency-key": randomUUID() }), data: body
  });
  expect(aal1.status()).toBe(403);
  expect((await aal1.json()).error.code).toBe("REAUTH_REQUIRED");
  const managerAal2 = await stepUpToAal2(managerSession.client);
  const done = await request.post(`/api/v1/bookings/${hold.booking_id}/service-cancel`, {
    headers: bearer(managerAal2, { "idempotency-key": randomUUID() }), data: body
  });
  expect(done.status()).toBe(200);
  expect((await done.json()).data).toMatchObject({ status: "CANCELLED", window: "SERVICE", refund_paise: Number(row!.total_paise) });

  // Even inside the late window, the customer sees a full refund in progress and why the booking was cancelled.
  await page.goto(`/bookings/${hold.booking_id}`);
  await expect(page.getByTestId("booking-status")).toHaveText("Cancelled");
  await expect(page.getByTestId("cancelled-notice")).toHaveText(
    "This booking was cancelled for you because the table is unavailable. You get a full refund.");
  await expect(page.getByTestId("refund-line")).toHaveText("₹300.00 (cancelled for you) - in progress, not yet confirmed by the payment provider");
});
