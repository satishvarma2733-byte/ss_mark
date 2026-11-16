// M5.2 accessibility (docs/08 T20): automated WCAG 2.0-2.2 A/AA checks with axe-core, reflow at 320 px (no horizontal
// scrolling, WCAG 1.4.10) and visible keyboard focus, across public, customer, partner, staff and admin pages.
// Automated checks find a subset of issues; screen-reader and zoom passes are recorded separately in the M5 handoff.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  CAFE_VENUE_ID, completedBooking, createFixtureUser, createQuickVenue, db, grantPlatformRole, holdThroughApi, payOnMockGateway,
  signInWithMfa, signedInCustomer
} from "./helpers";

type Finding = { page: string; width: number; rule: string; impact: string | null; help: string; targets: string[] };

async function scan(page: Page, label: string, width: number): Promise<Finding[]> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.map((v) => ({
    page: label, width, rule: v.id, impact: v.impact ?? null, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" "))
  }));
}

// WCAG 1.4.10: content reflows at 320 CSS px without two-dimensional scrolling (wide data tables may scroll inside
// their own container, which the page's scroll width does not include).
async function overflow(page: Page): Promise<{ extra: number; offenders: string[] }> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll("main *")]
      .filter((el) => el.getBoundingClientRect().right > width + 1 && !el.closest(".table-scroll"))
      .filter((el) => ![...el.children].some((child) => child.getBoundingClientRect().right > width + 1))
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ").join(".")}` : ""} "${(el.textContent ?? "").trim().slice(0, 30)}"`);
    return { extra: document.documentElement.scrollWidth - width, offenders };
  });
}

async function check(page: Page, path: string, label: string, ready?: (page: Page) => Promise<void>): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const [width, height] of [[1440, 900], [320, 640]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(path);
    if (ready) await ready(page);
    await page.waitForLoadState("networkidle");
    findings.push(...await scan(page, label, width));
    const { extra, offenders } = await overflow(page);
    if (extra > 1) findings.push({ page: label, width, rule: "reflow-320", impact: "serious", help: `page scrolls sideways by ${extra}px`, targets: offenders });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  return findings;
}

function report(findings: Finding[]) {
  for (const f of findings) console.info(`[a11y] ${f.page} @${f.width}: ${f.rule} (${f.impact}) ${f.help} :: ${f.targets.join(" | ")}`);
}

test("public and customer pages pass WCAG 2.2 A/AA checks and reflow at 320 px", async ({ page }) => {
  test.setTimeout(240_000);
  const [cafe] = await db()`select slug from public.venues where id = ${CAFE_VENUE_ID}::uuid`;
  const findings: Finding[] = [];
  findings.push(...await check(page, "/", "home"));
  findings.push(...await check(page, "/venues", "venues"));
  findings.push(...await check(page, `/venues/${cafe!.slug as string}`, "venue"));
  findings.push(...await check(page, "/sign-in", "sign-in"));
  findings.push(...await check(page, "/help", "help (signed out)"));

  const venue = await createQuickVenue({ tables: 2 });
  await signedInCustomer(page);
  const hold = await holdThroughApi(page, venue, 0, 30);
  findings.push(...await check(page, `/venues/${venue.slug}/book`, "book"));
  findings.push(...await check(page, `/checkout/${hold.booking_id}`, "checkout"));
  findings.push(...await check(page, "/bookings", "bookings"));
  findings.push(...await check(page, "/notifications", "notifications"));
  findings.push(...await check(page, "/account", "account"));
  findings.push(...await check(page, "/help", "help (signed in)"));
  report(findings);
  expect(findings).toEqual([]);
});

test("a confirmed booking, its cancel page and review page pass the same checks", async ({ page, request }) => {
  test.setTimeout(240_000);
  const { hold } = await completedBooking(page, request);
  const findings: Finding[] = [];
  findings.push(...await check(page, `/bookings/${hold.booking_id}`, "booking (completed)"));
  findings.push(...await check(page, `/bookings/${hold.booking_id}/review`, "review"));
  const venue = await createQuickVenue({ tables: 1 });
  const upcoming = await holdThroughApi(page, venue, 0, 240);
  await page.goto(`/checkout/${upcoming.booking_id}`);
  await payOnMockGateway(page, "mock-pay-success");
  await expect(page.getByTestId("payment-title")).toHaveText("Booking confirmed");
  findings.push(...await check(page, `/bookings/${upcoming.booking_id}`, "booking (confirmed)"));
  findings.push(...await check(page, `/bookings/${upcoming.booking_id}/cancel`, "cancel"));
  report(findings);
  expect(findings).toEqual([]);
});

test("partner, staff and admin portals pass WCAG 2.2 A/AA checks and reflow at 320 px", async ({ page }) => {
  test.setTimeout(300_000);
  const venue = await createQuickVenue({ tables: 2 });
  const user = await createFixtureUser();
  await db()`insert into public.venue_memberships (venue_id, user_id, role, status, accepted_at)
             select ${venue.venueId}::uuid, p.id, 'OWNER', 'ACTIVE', now() from public.profiles p where p.auth_user_id = ${user.id}::uuid`;
  await grantPlatformRole(user.id, "SUPERADMIN");
  await signInWithMfa(page, user.email, `/partner?venue=${venue.venueId}`);
  const q = `?venue=${venue.venueId}`;
  const findings: Finding[] = [];
  for (const [path, label] of [
    [`/partner${q}`, "partner today"], [`/partner/calendar${q}`, "partner calendar"], [`/partner/inventory${q}`, "partner inventory"], [`/partner/closures${q}`, "partner closures"], [`/partner/payouts${q}`, "partner payouts"], [`/partner/incidents/new${q}`, "partner incident"],
    [`/partner/venue${q}`, "partner venue"], [`/partner/staff${q}`, "partner staff"], [`/partner/reports${q}`, "partner reports"],
    [`/staff${q}`, "staff arrivals"], ["/admin", "admin"], ["/admin/venues", "admin venues"], ["/admin/support", "admin support"],
    ["/admin/reviews", "admin reviews"], ["/admin/finance/refunds", "admin refunds"], ["/admin/finance/fees", "admin fees"], ["/admin/bookings", "admin bookings"], ["/admin/finance", "admin finance"],
    ["/admin/metrics", "admin metrics"], ["/admin/release", "admin release switches"],
    [`/partner/notifications${q}`, "partner notifications"], ["/admin/notifications", "admin notifications"]
  ] as const) {
    findings.push(...await check(page, path, label));
  }
  report(findings);
  expect(findings).toEqual([]);
});

// Moves focus with Tab only until the focused element matches, then returns its description.
async function tabTo(page: Page, matches: (el: { testid: string | null; href: string | null; text: string }) => boolean, limit = 120) {
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press("Tab");
    const el = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return { testid: a?.getAttribute("data-testid") ?? null, href: a?.getAttribute("href") ?? null, text: (a?.textContent ?? "").trim() };
    });
    if (matches(el)) return el;
  }
  throw new Error("focus never reached the expected control");
}

test("a customer can book and pay using only the keyboard", async ({ page }) => {
  test.setTimeout(120_000);
  const venue = await createQuickVenue({ tables: 1 });
  await signedInCustomer(page);
  await page.goto(`/venues/${venue.slug}`);
  await tabTo(page, (el) => el.href?.includes("/book?resource=") ?? false);
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/book\?/);
  await expect(page.getByTestId("quote")).toBeVisible();
  await tabTo(page, (el) => el.testid === "accept-rules");
  await page.keyboard.press("Space");
  await tabTo(page, (el) => el.testid === "hold-table");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/checkout\//);
  await tabTo(page, (el) => el.testid === "pay");
  await page.keyboard.press("Enter");
  await expect(page.getByText("MOCK PAYMENT GATEWAY - TEST MODE")).toBeVisible();
  await tabTo(page, (el) => el.testid === "mock-pay-success");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("payment-title")).toHaveText("Booking confirmed");
});

test("keyboard users see where focus is on every page they tab through", async ({ page }) => {
  const [cafe] = await db()`select slug from public.venues where id = ${CAFE_VENUE_ID}::uuid`;
  const missing: string[] = [];
  for (const path of ["/", `/venues/${cafe!.slug as string}`, "/sign-in", "/help"]) {
    await page.goto(path);
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press("Tab");
      const state = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        const visible = (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none";
        return { visible, name: `${el.tagName.toLowerCase()} ${(el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 40)}` };
      });
      if (state && !state.visible) missing.push(`${path}: ${state.name}`);
    }
  }
  expect([...new Set(missing)]).toEqual([]);
});

// Dark theme (16 Nov 2026): the same axe rules with the dark colour scheme, on customer, partner and admin pages.
test("dark mode passes WCAG 2.2 A/AA checks on customer, partner and admin pages", async ({ page }) => {
  test.setTimeout(300_000);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1440, height: 900 });
  const venue = await createQuickVenue({ tables: 2 });
  const findings: Finding[] = [];
  const dark = async (path: string, label: string) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
    findings.push(...await scan(page, `${label} (dark)`, 1440));
  };
  for (const [path, label] of [["/", "home"], ["/venues", "venues"], [`/venues/${venue.slug}`, "venue"], ["/sign-in", "sign-in"], ["/help", "help"]] as const) {
    await dark(path, label);
  }
  const user = await createFixtureUser();
  await db()`insert into public.venue_memberships (venue_id, user_id, role, status, accepted_at)
             select ${venue.venueId}::uuid, p.id, 'OWNER', 'ACTIVE', now() from public.profiles p where p.auth_user_id = ${user.id}::uuid`;
  await grantPlatformRole(user.id, "SUPERADMIN");
  await signInWithMfa(page, user.email, `/partner?venue=${venue.venueId}`);
  const q = `?venue=${venue.venueId}`;
  for (const [path, label] of [
    ["/bookings", "bookings"], ["/account", "account"], ["/notifications", "notifications"],
    [`/partner${q}`, "partner today"], [`/partner/calendar${q}`, "partner calendar"], [`/partner/inventory${q}`, "partner inventory"],
    [`/partner/payouts${q}`, "partner payouts"], [`/partner/staff${q}`, "partner staff"], [`/staff${q}`, "staff arrivals"],
    ["/admin", "admin"], ["/admin/venues", "admin venues"], ["/admin/bookings", "admin bookings"], ["/admin/finance", "admin finance"],
    ["/admin/finance/refunds", "admin refunds"], ["/admin/support", "admin support"], ["/admin/reviews", "admin reviews"],
    ["/admin/metrics", "admin metrics"], ["/admin/release", "admin release switches"],
    [`/partner/notifications${q}`, "partner notifications"], ["/admin/notifications", "admin notifications"]
  ] as const) {
    await dark(path, label);
  }
  report(findings);
  expect(findings).toEqual([]);
});
