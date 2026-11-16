// Web sign-in, sign-out, return-path allowlist, portal denial and staff MFA against the real local Auth server.
import { expect, test } from "@playwright/test";
import { CAFE_VENUE_ID, createFixtureUser, signInWithEmailCode as signIn, totp } from "./helpers";

test("a customer signs in with an emailed code, sees their account and signs out", async ({ page, context }) => {
  const user = await createFixtureUser();
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?redirect_path=(%2F|\/)account$/);
  await signIn(page, user.email);

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByTestId("account-email")).toHaveText(user.email);
  await expect(page.getByTestId("account-status")).toHaveText("ACTIVE");
  const cookies = await context.cookies();
  const session = cookies.filter((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
  expect(session.length).toBeGreaterThan(0);
  expect(session.every((c) => c.httpOnly && c.sameSite === "Lax")).toBe(true);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("a first-time account accepts terms at sign-in", async ({ page }) => {
  const user = await createFixtureUser({ acceptTerms: false });
  await page.goto("/sign-in?redirect_path=/account");
  await signIn(page, user.email, { acceptTerms: true });
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Terms" })).toHaveCount(0);
});

test("an external return path is ignored after sign-in", async ({ page }) => {
  const user = await createFixtureUser();
  await page.goto("/sign-in?redirect_path=//evil.example/steal");
  await signIn(page, user.email);
  await expect(page).toHaveURL("http://localhost:3100/");
});

test("a signed-in customer without a venue role sees only the application entry; venue screens are denied", async ({ page }) => {
  const user = await createFixtureUser();
  await page.goto("/sign-in?redirect_path=/partner");
  await signIn(page, user.email);
  // M4.3: /partner is where anyone can apply to list a venue or accept an invitation; it shows no venue data.
  await expect(page.getByTestId("partner-apply-link")).toBeVisible();
  await expect(page.getByTestId("today-bookings")).toHaveCount(0);
  await page.goto("/partner/calendar");
  await expect(page.getByTestId("portal-denied")).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByTestId("portal-denied")).toBeVisible();
});

test("assigned staff must enrol an authenticator before the partner portal opens", async ({ page }) => {
  const staff = await createFixtureUser({ venueRole: { venueId: CAFE_VENUE_ID, role: "STAFF" } });
  await page.goto("/sign-in?redirect_path=/partner");
  await signIn(page, staff.email);
  await expect(page.getByTestId("portal-mfa-required")).toBeVisible();

  await page.getByRole("link", { name: "Continue to authenticator check" }).click();
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  const secret = (await page.getByTestId("mfa-secret").textContent())!.trim();
  await page.getByLabel("6-digit authenticator code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page).toHaveURL(/\/partner$/);
  await expect(page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)\.$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /DEMO Cafe Koramangala/ })).toBeVisible();
  await expect(page.locator(".badge", { hasText: "STAFF" })).toBeVisible();
});
