// M4.6 inbox and metrics in real browsers against the local stack. Fictional data; the email provider is a MOCK.
import { expect, test } from "@playwright/test";
import { createFixtureUser, createQuickVenue, db, evidence, grantPlatformRole, holdThroughApi, payOnMockGateway, signInWithMfa, signedInCustomer } from "./helpers";

test("a confirmed booking appears in the inbox; opening it marks it read and goes to the booking", async ({ page }) => {
  test.setTimeout(120_000);
  const venue = await createQuickVenue({ tables: 1 });
  await signedInCustomer(page);
  await page.goto("/notifications");
  await expect(page.getByTestId("notifications-empty")).toBeVisible();

  const hold = await holdThroughApi(page, venue, 0, 1);
  await page.goto(`/checkout/${hold.booking_id}`);
  await payOnMockGateway(page, "mock-pay-success");
  await expect(page.getByTestId("payment-title")).toHaveText("Booking confirmed");
  // The worker is not running in e2e: run its booking.confirmed handler directly (exactly what the job does).
  await db()`select app.job_notify_booking(${hold.booking_id}::uuid, ${"booking:" + hold.booking_id + ":confirmed"}, 'booking_confirmed')`;

  await page.goto("/notifications");
  await expect(page.getByTestId("unread-count")).toHaveText("1 unread");
  const item = page.getByTestId("notifications").getByRole("button", { name: /Unread: Booking confirmed/ });
  await expect(item).toContainText(hold.public_ref);
  await evidence(page, "web-m46-01-inbox");
  await item.click();
  await page.waitForURL(`**/bookings/${hold.booking_id}`);
  await page.goto("/notifications");
  await expect(page.getByTestId("unread-count")).toHaveCount(0);
  await expect(page.getByTestId("notifications").getByRole("button", { name: /^Booking confirmed/ })).toBeVisible();
});

test("support sees business metrics with their definitions and no money; finance also sees money flagged when unreconciled", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const support = await createFixtureUser();
  await grantPlatformRole(support.id, "SUPPORT");
  await signInWithMfa(page, support.email, "/admin/metrics");
  await expect(page.getByRole("heading", { name: "Metrics" })).toBeVisible();
  await expect(page.getByTestId("metrics-funnel")).toContainText("Conversion");
  await expect(page.getByTestId("metrics-funnel")).toContainText("as a share of all holds created in the period");
  await expect(page.getByTestId("metrics-finance")).toHaveCount(0);
  await evidence(page, "web-m46-02-metrics-support");

  const finance = await createFixtureUser();
  await grantPlatformRole(finance.id, "FINANCE");
  const ctx = await browser.newContext();
  const f = await ctx.newPage();
  await signInWithMfa(f, finance.email, "/admin/metrics");
  await expect(f.getByTestId("metrics-finance")).toContainText("Collected (not revenue)");
  await ctx.close();

  const tooLong = await page.request.get("/api/v1/admin/metrics?from=2026-01-01&to=2026-11-01");
  expect(tooLong.status()).toBe(422);
});

test("the partner and admin bells open a notification centre inside each workspace", async ({ page }) => {
  test.setTimeout(120_000);
  const venue = await createQuickVenue({ tables: 1 });
  const user = await createFixtureUser({ venueRole: { venueId: venue.venueId, role: "MANAGER" } });
  await grantPlatformRole(user.id, "SUPPORT");
  await signInWithMfa(page, user.email, `/partner?venue=${venue.venueId}`);

  await page.getByRole("link", { name: "Notifications" }).click();
  await page.waitForURL(`**/partner/notifications?venue=${venue.venueId}`);
  await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
  await expect(page.locator(".portal-sidebar")).toBeVisible();
  await expect(page.getByText("Nothing yet")).toBeVisible();

  await page.goto("/admin");
  await page.getByRole("link", { name: "Notifications" }).click();
  await page.waitForURL("**/admin/notifications");
  await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
  await expect(page.locator(".portal-sidebar")).toBeVisible();
});
