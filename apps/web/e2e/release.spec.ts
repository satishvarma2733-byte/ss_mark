// M6 release switches in a real browser against the local stack (docs/06 rollback procedure, docs/08 s.4): a
// superadmin pauses new bookings with a reason, customers see the paused state and cannot start one, and reopening
// restores booking. Also: a native client older than NATIVE_MIN_VERSION is refused new bookings (playwright.config.ts).
import { expect, test } from "@playwright/test";
import { CAFE_TABLE_1, CAFE_VENUE_ID, apiPost, createFixtureUser, db, evidence, grantPlatformRole, istSlot, signInWithMfa, signedInCustomer } from "./helpers";

test.afterAll(async () => {
  await db()`update public.release_switches set is_open = true where key in ('BOOKINGS', 'EXTENSIONS')`;
});

test("a superadmin pauses and reopens new bookings; customers see why and cannot start one meanwhile", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const admin = await createFixtureUser();
  await grantPlatformRole(admin.id, "SUPERADMIN");
  await signInWithMfa(page, admin.email, "/admin/release");
  await expect(page.getByRole("heading", { name: "Release switches" })).toBeVisible();
  await expect(page.getByTestId("switch-state-BOOKINGS")).toHaveText("Open");
  await expect(page.getByTestId("native-min-version")).toContainText("0.1.0 or newer");

  await page.getByTestId("switch-reason-BOOKINGS").fill("E2E drill: payment provider incident");
  await page.getByTestId("switch-toggle-BOOKINGS").click();
  await expect(page.getByTestId("switch-state-BOOKINGS")).toHaveText("Paused");
  await expect(page.getByTestId("switch-BOOKINGS")).toContainText("E2E drill: payment provider incident");
  await evidence(page, "web-m6-01-bookings-paused-admin");

  const ctx = await browser.newContext();
  const customerPage = await ctx.newPage();
  await signedInCustomer(customerPage);
  await customerPage.goto("/venues/demo-cafe-koramangala");
  await expect(customerPage.getByTestId("bookings-paused")).toContainText("New bookings are paused for now");
  await expect(customerPage.getByTestId("table-slots")).toHaveCount(0);
  await evidence(customerPage, "web-m6-02-venue-paused");
  const quote = { venue_id: CAFE_VENUE_ID, resource_id: CAFE_TABLE_1, start_at: istSlot(5, "10:00"), duration_minutes: 60, party_size: 2 };
  const paused = await apiPost(customerPage, "/api/v1/quotes", quote);
  expect(paused).toMatchObject({ status: 503, body: { error: { code: "BOOKINGS_PAUSED" } } });
  // Customers keep their bookings page and the public status says why.
  await customerPage.goto("/bookings");
  await expect(customerPage.getByRole("heading", { name: "Your good hours, in one place." })).toBeVisible();
  const status = await customerPage.request.get("/api/v1/service-status");
  expect((await status.json()).data).toEqual({ bookings_open: false, extensions_open: true, native_min_version: "0.1.0" });

  await page.getByTestId("switch-reason-BOOKINGS").fill("E2E drill finished: provider healthy again");
  await page.getByTestId("switch-toggle-BOOKINGS").click();
  await expect(page.getByTestId("switch-state-BOOKINGS")).toHaveText("Open");
  await customerPage.goto("/venues/demo-cafe-koramangala");
  await expect(customerPage.getByTestId("bookings-paused")).toHaveCount(0);
  await expect(customerPage.getByTestId("table-slots").first()).toBeVisible();
  expect((await apiPost(customerPage, "/api/v1/quotes", quote)).status).toBe(201);

  const [audit] = await db()`select count(*)::int as n from public.audit_events
                             where action in ('release_switch.closed', 'release_switch.opened') and reason like 'E2E drill%'`;
  expect(audit!.n).toBeGreaterThanOrEqual(2);
  await ctx.close();
});

test("support sees the switches but cannot change them", async ({ page }) => {
  const support = await createFixtureUser();
  await grantPlatformRole(support.id, "SUPPORT");
  await signInWithMfa(page, support.email, "/admin/release");
  await expect(page.getByTestId("switch-state-BOOKINGS")).toBeVisible();
  await expect(page.getByTestId("switch-toggle-BOOKINGS")).toHaveCount(0);
  await expect(page.getByTestId("switch-BOOKINGS")).toContainText("Superadmin can change this.");
  const forced = await apiPost(page, "/api/v1/admin/release-switches",
    { key: "BOOKINGS", is_open: false, reason: "Support should not be able to do this", expected_version: 1 }, { "idempotency-key": crypto.randomUUID() });
  expect(forced).toMatchObject({ status: 403, body: { error: { code: "FORBIDDEN" } } });
});

test("a native app older than the supported minimum cannot start a booking but keeps its bookings", async ({ page }) => {
  await signedInCustomer(page);
  const quote = { venue_id: CAFE_VENUE_ID, resource_id: CAFE_TABLE_1, start_at: istSlot(6, "10:00"), duration_minutes: 60, party_size: 2 };
  const old = await apiPost(page, "/api/v1/quotes", quote, { "x-simply-sit-client": "android/0.0.9" });
  expect(old).toMatchObject({ status: 426, body: { error: { code: "UPDATE_REQUIRED", details: { minimum_version: "0.1.0" } } } });
  expect((await apiPost(page, "/api/v1/quotes", quote, { "x-simply-sit-client": "ios/0.1.0" })).status).toBe(201);
  const list = await page.request.get("/api/v1/bookings", { headers: { "x-simply-sit-client": "android/0.0.9" } });
  expect(list.status()).toBe(200);
});
