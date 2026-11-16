// TEMPORARY design-preview capture (delete after use). Signs in a fictional manager of the mock venue "The Verandah
// House" with an authenticator, also grants platform admin, saves the session and screenshots the portal pages.
import { test } from "@playwright/test";
import { createFixtureUser, grantPlatformRole, signInWithMfa } from "./helpers";

const VERANDAH = "22222222-2222-4222-8222-000000000101";
const OUT = process.env.PREVIEW_OUT ?? "preview-shots";
const PAGES = (process.env.PREVIEW_PAGES ?? "/partner,/partner/calendar,/partner/inventory,/partner/venue,/partner/reports,/partner/staff,/staff,/admin")
  .split(",")
  .filter(Boolean);

test("design preview capture", async ({ page }) => {
  const user = await createFixtureUser({ venueRole: { venueId: VERANDAH, role: "MANAGER" } });
  await grantPlatformRole(user.id, "SUPERADMIN");
  await signInWithMfa(page, user.email, `/partner?venue=${VERANDAH}`);
  await page.context().storageState({ path: `${OUT}/session.json` });
  for (const path of PAGES) {
    const url = path.startsWith("/partner") || path === "/staff" ? `${path}?venue=${VERANDAH}` : path;
    if (path.endsWith("/first") || path.endsWith("#first")) {
      // "/admin/venues/first" or "/admin/bookings?date=...#first" opens the first record in the list.
      await page.goto(path.replace(/\/first$|#first$/, ""));
      await page.locator('[data-testid="venue-queue"] a, [data-testid="booking-results"] a').first().click();
      await page.waitForURL(/\/[0-9a-f-]{36}/);
    } else {
      await page.goto(url);
    }
    await page.waitForLoadState("networkidle");
    if (process.env.PREVIEW_WIDTH) {
      // Reflow probe: list elements whose right edge passes the viewport.
      await page.setViewportSize({ width: Number(process.env.PREVIEW_WIDTH), height: 800 });
      const wide = await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ el, r }) => (r.right > window.innerWidth + 1 && r.width > 0) || (getComputedStyle(el).overflowX === "visible" && r.left + el.scrollWidth > window.innerWidth + 1))
          .map(({ el, r }) => {
            let clip = "";
            for (let p = el.parentElement; p; p = p.parentElement) {
              const o = getComputedStyle(p).overflowX;
              if (o !== "visible") { clip = `${p.tagName.toLowerCase()}.${(p as HTMLElement).className}:${o}`; break; }
            }
            return `${el.tagName.toLowerCase()}.${(el as HTMLElement).className} right=${Math.round(r.right)} w=${Math.round(r.width)} clip=${clip}`;
          })
          .filter((s) => !s.includes("table-scroll"))
          .slice(0, 20)
      );
      console.info(`[reflow ${path}] scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`, wide);
    }
    const name = path.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  }
});
