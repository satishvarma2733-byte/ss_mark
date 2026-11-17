// Step D screens (16 Nov 2026): partner support centre, admin venue directory and read-only system settings.
import { expect, test } from "@playwright/test";
import { createFixtureUser, createQuickVenue, grantPlatformRole, signInWithMfa } from "./helpers";

test("partner support centre, admin venue directory and system settings render real data inside their workspaces", async ({ page }) => {
  test.setTimeout(150_000);
  const venue = await createQuickVenue({ tables: 2 });
  const user = await createFixtureUser({ venueRole: { venueId: venue.venueId, role: "MANAGER" } });
  await grantPlatformRole(user.id, "SUPPORT");
  await signInWithMfa(page, user.email, `/partner?venue=${venue.venueId}`);

  // Partner support centre: reached from the sidebar, empty until a case is opened.
  await page.locator(".portal-access").getByRole("link", { name: "Support centre" }).click();
  await page.waitForURL(`**/partner/support?venue=${venue.venueId}`);
  await expect(page.getByRole("heading", { name: "Support centre", level: 1 })).toBeVisible();
  await expect(page.getByText("No cases yet")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create a linked support ticket" })).toBeVisible();

  // Venue directory: search finds the venue by its slug and links to its record.
  await page.goto("/admin/directory");
  await expect(page.getByRole("heading", { name: "Partner and venue management", level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Search").fill(venue.slug);
  await page.getByRole("button", { name: "Search" }).click();
  await page.waitForURL(/\/admin\/directory\?q=/);
  const directory = page.getByTestId("venue-directory");
  await expect(directory.getByRole("row")).toHaveCount(2);
  await expect(directory).toContainText(venue.slug);
  await expect(directory).toContainText("Published");
  await expect(directory.getByRole("link", { name: "Open partner record" })).toHaveAttribute("href", `/admin/venues/${venue.venueId}`);
  // LIKE wildcards are matched literally: "%" alone finds nothing instead of everything.
  await page.goto("/admin/directory?q=%25");
  await expect(page.getByText("No venues match")).toBeVisible();

  // System settings: read-only facts about this deployment.
  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "System settings", level: 1 })).toBeVisible();
  const settings = page.getByTestId("system-settings");
  await expect(settings).toContainText("Asia/Kolkata (IST)");
  await expect(settings).toContainText("mock");
  await expect(page.getByRole("button", { name: /save/i })).toHaveCount(0);
});
