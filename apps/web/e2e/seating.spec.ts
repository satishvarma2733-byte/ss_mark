// Seat-map phase 2 in a real browser: a manager adds an area, moves tables into it, places them on the floor, sees an
// overlap flagged before saving, publishes, then sets an area price and a special table price. Guests then see the
// published floor and "from" price through the public seating API. Fictional data only.
import { expect, test, type Page } from "@playwright/test";
import { createFixtureUser, createQuickVenue, db, evidence, signInWithMfa } from "./helpers";

async function tableBox(page: Page, label: string) {
  const box = await page.getByTestId("floor-canvas").getByRole("button", { name: new RegExp(`^${label}, `) }).boundingBox();
  if (!box) throw new Error(`${label} is not on the floor`);
  return box;
}

test("a manager draws, checks and publishes a floor, then prices the area and one special table", async ({ page, request }) => {
  test.setTimeout(150_000);
  const venue = await createQuickVenue({ tables: 3 });
  const manager = await createFixtureUser({ venueRole: { venueId: venue.venueId, role: "MANAGER" } });
  await signInWithMfa(page, manager.email, `/partner/floor?venue=${venue.venueId}`);

  await expect(page.getByRole("heading", { name: "Set up your dine-in floor" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start with an area" })).toBeVisible();
  await page.getByLabel("New area").fill("Ground floor");
  await page.getByRole("button", { name: "Add area" }).click();
  await expect(page.getByText("Added “Ground floor”.")).toBeVisible();
  await expect(page.getByTestId("area-list").getByRole("button", { name: /Ground floor/ })).toHaveAttribute("aria-current", "true");

  // Tables that are in no area yet can be moved in with one click each.
  await page.getByRole("button", { name: "Move Quick table 1 here" }).click();
  await expect(page.getByText("Quick table 1 is now in Ground floor.")).toBeVisible();
  await page.getByRole("button", { name: "Move Quick table 2 here" }).click();
  await expect(page.getByText("Quick table 2 is now in Ground floor.")).toBeVisible();

  await page.getByTestId("unplaced-tables").getByRole("button", { name: /Quick table 1/ }).click();
  await page.getByTestId("unplaced-tables").getByRole("button", { name: /Quick table 2/ }).click();
  await page.getByRole("button", { name: "Door", exact: true }).click();
  await expect(page.getByTestId("publish-bar")).toContainText("Unsaved changes");
  await expect(page.getByTestId("publish-bar")).toContainText("2 tables · 8 seats · no overlaps");

  // Drag table 2 onto table 1: flagged at once, and publishing is blocked.
  await page.getByTestId("floor-canvas").scrollIntoViewIfNeeded();
  const one = await tableBox(page, "Quick table 1");
  const two = await tableBox(page, "Quick table 2");
  await page.mouse.move(two.x + two.width / 2, two.y + two.height / 2);
  await page.mouse.down();
  await page.mouse.move(one.x + one.width / 2 + 10, one.y + one.height / 2 + 10, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("floor-problems")).toContainText("overlaps another table");
  await expect(page.getByTestId("publish-floor")).toBeDisabled();
  await evidence(page, "web-seat-01-overlap");

  // Nudge it clear with the keyboard (arrow keys move 10 units).
  await page.getByTestId("floor-canvas").getByRole("button", { name: /^Quick table 2, / }).focus();
  for (let i = 0; i < 14; i += 1) await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("floor-problems")).toHaveCount(0);
  await expect(page.getByTestId("table-panel")).toBeVisible();

  await page.getByTestId("publish-floor").click();
  await expect(page.getByText(/Published\. Guests now see this floor for Ground floor/)).toBeVisible();
  await expect(page.getByTestId("publish-bar")).toContainText("Published v1");
  await evidence(page, "web-seat-02-published");

  const seating = await (await request.get(`/api/v1/venues/${venue.venueId}/seating`)).json();
  const zone = seating.data.zones[0];
  expect(zone).toMatchObject({ name: "Ground floor", table_count: 2, from_hourly_paise: 30000 });
  expect(zone.layout.elements.map((e: { type: string }) => e.type).sort()).toEqual(["DOOR", "TABLE", "TABLE"]);

  // Prices: the area to ₹250/hr, then Quick table 1 to ₹280/hr as a special table.
  await page.getByRole("link", { name: "Prices" }).click();
  await expect(page.getByRole("heading", { name: "Set your prices" })).toBeVisible();
  const area = page.getByTestId("area-price-Ground floor");
  await area.getByLabel("Hourly price for Ground floor, rupees").fill("250");
  await area.getByRole("button", { name: "Apply to area" }).click();
  await expect(area.getByText("Ground floor: ₹250.00/hr from now.")).toBeVisible();
  // Every table in the area follows, and its price box shows the new price.
  await expect(page.getByTestId("table-price-Quick table 2").getByLabel("Hourly price for Quick table 2, rupees")).toHaveValue("250");
  const special = page.getByTestId("table-price-Quick table 1");
  await special.getByLabel("Hourly price for Quick table 1, rupees").fill("280");
  await special.getByRole("button", { name: "Set price" }).click();
  await expect(special.getByText("Quick table 1: ₹280.00/hr.")).toBeVisible();
  await expect(special.getByText("Special price")).toBeVisible();
  await expect(page.getByTestId("guest-preview")).toContainText("from ₹250.00/hr");
  await evidence(page, "web-seat-03-prices");

  const priced = await (await request.get(`/api/v1/venues/${venue.venueId}/seating`)).json();
  expect(priced.data.zones[0].from_hourly_paise).toBe(25000);

  // Step 3: a busy-hour price (default: Fri, Sat, Sun 18:00-22:00, +20%), shown in the list and the week strip; then stopped.
  const busy = page.getByTestId("busy-hours");
  await expect(busy.getByText("No busy-hour prices yet.")).toBeVisible();
  await expect(busy.getByTestId("busy-example")).toContainText("becomes");
  await busy.getByRole("button", { name: "Add busy-hour price" }).click();
  await expect(busy.getByText(/Added “Busy evenings”: \+20%/)).toBeVisible();
  const rule = busy.getByTestId("busy-rule-Busy evenings");
  await expect(rule).toContainText("Busy evenings · +20%");
  await expect(rule).toContainText("Fri, Sat, Sun · 18:00–22:00 · All areas");
  await evidence(page, "web-seat-05-busy-hours");
  await rule.getByRole("button", { name: "Stop" }).click();
  await expect(busy.getByText("No busy-hour prices yet.")).toBeVisible();
});

test("a guest picks an area, a time and a table on the floor plan, then goes on to hold it", async ({ page }) => {
  const venue = await createQuickVenue({ tables: 2 });
  const sql = db();
  // A published area with both tables (as the partner pages would create it).
  const [zone] = await sql`insert into public.venue_zones (venue_id, name, kind) values (${venue.venueId}::uuid, 'Garden', 'OUTDOOR') returning id`;
  await sql`update public.resources set zone_id = ${zone!.id as string}::uuid, shape = 'ROUND', features = '{VIEW}' where venue_id = ${venue.venueId}::uuid`;
  const [layout] = await sql`insert into public.floor_layouts (zone_id, venue_id, layout_version, width, height)
                             values (${zone!.id as string}::uuid, ${venue.venueId}::uuid, 1, 400, 260) returning id`;
  await sql`insert into public.layout_elements (layout_id, element_type, resource_id, x, y, width, height, sort_order) values
            (${layout!.id as string}::uuid, 'TABLE', ${venue.tableIds[0]!}::uuid, 40, 60, 90, 90, 0),
            (${layout!.id as string}::uuid, 'TABLE', ${venue.tableIds[1]!}::uuid, 220, 60, 90, 90, 1)`;
  await sql`insert into public.layout_elements (layout_id, element_type, label, x, y, width, height, sort_order)
            values (${layout!.id as string}::uuid, 'DOOR', 'Gate', 300, 220, 90, 30, 2)`;
  await sql`update public.floor_layouts set status = 'PUBLISHED', published_at = now() where id = ${layout!.id as string}::uuid`;

  // A venue-wide busy-hour price for the whole day (+20%): the panel includes it and the total goes up.
  await sql`insert into public.rate_rules (venue_id, label, weekdays, starts_local, ends_local, adjustment_bps)
            values (${venue.venueId}::uuid, 'Festival week', '{0,1,2,3,4,5,6}', '00:00', '23:59:59', 2000)`;

  await page.goto(`/venues/${venue.slug}?party=2`);
  const picker = page.getByTestId("seat-map-picker");
  // The per-table list shows the usual price and says busy-hour prices exist.
  await expect(page.getByTestId("busy-pricing-note")).toBeVisible();
  await expect(picker.getByRole("heading", { name: "Where would you like to sit?" })).toBeVisible();
  await expect(picker.getByRole("tab", { name: /Garden/ })).toHaveAttribute("aria-selected", "true");
  await expect(picker.getByRole("tab", { name: /Garden/ })).toContainText("From ₹300.00/hr");
  await expect(picker.getByTestId("seat-summary")).toContainText("2 free");
  await expect(picker.getByText("Gate")).toBeVisible();

  await picker.getByRole("button", { name: /^Quick table 2, 4 seats, free/ }).click();
  const panel = picker.getByTestId("seat-panel");
  await expect(panel.getByRole("heading", { name: "Quick table 2" })).toBeVisible();
  await expect(panel).toContainText("Nice view");
  await expect(panel).toContainText("₹300.00/hr");
  await expect(panel).toContainText("₹360.00");
  await expect(panel.getByTestId("seat-busy")).toHaveText("Includes a busy-hour price (+20%).");
  await evidence(page, "web-seat-04-customer-map");
  await panel.getByTestId("seat-hold").click();
  // Holding needs an account: a signed-out guest goes to sign-in, which returns to this table and time.
  await page.waitForURL(/\/sign-in\?redirect_path=/);
  expect(new URL(page.url()).searchParams.get("redirect_path"))
    .toMatch(new RegExp(`^/venues/${venue.slug}/book\\?resource=${venue.tableIds[1]}&start=.+&duration=60&party=2$`));

  // A bigger group: no table in the area seats 5, so no start time is offered and the guest is told why.
  await page.goto(`/venues/${venue.slug}?party=5`);
  await expect(page.getByTestId("seat-map-picker")).toContainText("No table in Garden is free for 5 guests");
});
