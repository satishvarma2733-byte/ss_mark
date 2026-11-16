import { expect, test } from "@playwright/test";

test("customer search shows synthetic venues and the mock banner", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "A place for your next good hour." })).toBeVisible();
  await expect(page.getByText("SYNTHETIC DATA - MOCK MODE")).toBeVisible();
  await page.getByRole("button", { name: "Find a space" }).click();
  await expect(page).toHaveURL(/\/venues\?/);
  await expect(page.getByRole("link", { name: "DEMO Cafe Koramangala", exact: true })).toBeVisible();
});

test("empty and error states are demonstrated", async ({ page }) => {
  await page.goto("/venues?area=koramangala&party=10");
  await expect(page.getByText("No spaces match these details yet.")).toBeVisible();

  await page.goto("/?state=error");
  // Next.js adds its own role="alert" route announcer, so select by the message text instead.
  await expect(page.getByRole("alert").filter({ hasText: "We could not load this page" })).toBeVisible();
});

test("venue page renders the fictional price and food rule", async ({ page }) => {
  await page.goto("/venues/demo-cafe-koramangala");
  // 60 minutes = two 30-minute blocks at ₹150.00 each (fictional).
  await expect(page.getByText("₹300.00")).toBeVisible();
  await expect(page.getByText("Outside food allowed at this table")).toBeVisible();
});

test("portal shells render and the health endpoint answers", async ({ page, request }) => {
  for (const path of ["/partner", "/staff", "/admin"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
  const health = await request.get("/api/v1/health");
  expect(health.status()).toBe(200);
  const body = await health.json();
  expect(body.status).toBe("ok");
  expect(body.providers).toEqual({ payment: "mock", email: "mock", maps: "mock" });
  expect(body.policyVersion).toBe("proposed-2026-10-25");
});
