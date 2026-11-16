// M4.5 reviews, support and confidential incidents in real browsers against the local stack. Fictional data only.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  bearer, completedBooking, createFixtureUser, db, evidence, grantPlatformRole, nativeSignIn, signInWithMfa, signedInCustomer, stepUpToAal2
} from "./helpers";

test("a completed visit is reviewed once, checked by support, then shown on the venue page", async ({ page, browser, request }) => {
  test.setTimeout(150_000);
  const { venue, hold } = await completedBooking(page, request);
  await page.goto(`/bookings/${hold.booking_id}`);
  await page.getByRole("link", { name: "Rate your visit" }).click();
  await page.getByTestId("rating-5").check();
  await page.getByTestId("review-body").fill("Quiet corner and good light (e2e).");
  await page.getByTestId("review-submit").click();
  await expect(page.getByText("Thanks for your review.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("review-status")).toContainText("waiting for a quick check");
  await evidence(page, "web-m45-01-review-pending");

  const support = await createFixtureUser();
  await grantPlatformRole(support.id, "SUPPORT");
  const ctx = await browser.newContext();
  const admin = await ctx.newPage();
  await signInWithMfa(admin, support.email, "/admin/reviews");
  const [review] = await db()`select id from public.reviews where booking_id = ${hold.booking_id}::uuid`;
  await admin.getByTestId(`open-review-${review!.id}`).click();
  await admin.getByTestId(`publish-${review!.id}`).click();
  // Published reviews leave the "to check" list.
  await expect(admin.getByTestId(`publish-${review!.id}`)).toHaveCount(0);
  expect((await db()`select moderation_status from public.reviews where id = ${review!.id as string}::uuid`)[0]).toEqual({ moderation_status: "PUBLISHED" });
  await ctx.close();

  const [v] = await db()`select slug from public.venues where id = ${venue.venueId}::uuid`;
  await page.goto(`/venues/${v!.slug as string}`);
  await expect(page.getByTestId("venue-reviews")).toContainText("Quiet corner and good light (e2e).");
  await evidence(page, "web-m45-02-venue-reviews");
});

test("a support request is triaged with a private note and the customer sees only the reply", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await signedInCustomer(page);
  await page.goto("/help");
  await expect(page.getByTestId("emergency")).toContainText("112");
  await page.getByTestId("ticket-category").selectOption("PAYMENT");
  await page.getByTestId("ticket-description").fill("I think I was charged twice for my booking (e2e).");
  await page.getByTestId("ticket-submit").click();
  await expect(page.getByTestId("ticket-status")).toContainText("Received");
  const ticketUrl = page.url();

  const support = await createFixtureUser();
  await grantPlatformRole(support.id, "SUPPORT");
  const ctx = await browser.newContext();
  const admin = await ctx.newPage();
  await signInWithMfa(admin, support.email, "/admin/support");
  const ticketId = ticketUrl.split("/").pop()!;
  await admin.goto(`/admin/support/${ticketId}`);
  await admin.getByTestId("ticket-note-input").fill("Provider shows a single capture (private, e2e).");
  await admin.getByTestId("ticket-status-select").selectOption("RESOLVED");
  await admin.getByTestId("ticket-resolution-input").fill("We checked with the payment provider: you were charged once.");
  await admin.getByTestId("ticket-save").click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  await admin.reload();
  await expect(admin.getByTestId("ticket-notes")).toContainText("single capture");
  await evidence(admin, "web-m45-03-admin-ticket");
  await admin.getByLabel("Why do you need their email? (recorded)").fill("Customer asked for a call back (e2e)");
  await admin.getByRole("button", { name: "Show email" }).click();
  await expect(admin.getByTestId("revealed-email")).toContainText("@example.test");
  await ctx.close();

  await page.goto(ticketUrl);
  await expect(page.getByTestId("ticket-resolution")).toContainText("you were charged once");
  await expect(page.getByText("single capture")).toHaveCount(0);
  await evidence(page, "web-m45-04-customer-reply");
});

test("a confidential staff incident is hidden from unassigned support and from customers", async ({ page, request }) => {
  const { venue, hold, staffToken } = await completedBooking(page, request);
  const report = await request.post("/api/v1/partner/incidents", {
    headers: bearer(staffToken, { "idempotency-key": randomUUID() }),
    data: { venue_id: venue.venueId, booking_id: hold.booking_id, category: "SAFETY", description: "Guest felt unsafe near the entrance (e2e).", sensitive: true }
  });
  expect(report.status()).toBe(201);
  const incident = (await report.json()).data as { ticket_id: string; is_sensitive: boolean };
  expect(incident.is_sensitive).toBe(true);

  // The customer of that booking cannot read the staff report.
  const customerView = await page.request.get(`/api/v1/support-tickets/${incident.ticket_id}`);
  expect(customerView.status()).toBe(404);

  const support = await createFixtureUser();
  await grantPlatformRole(support.id, "SUPPORT");
  const session = await nativeSignIn(support.email);
  const supportToken = await stepUpToAal2(session.client);
  const queue = await request.get("/api/v1/admin/support-tickets?status=OPEN", { headers: bearer(supportToken) });
  const body = (await queue.json()).data as { tickets: { ticket_id: string }[]; restricted_count: number };
  expect(body.tickets.map((t) => t.ticket_id)).not.toContain(incident.ticket_id);
  expect(body.restricted_count).toBeGreaterThan(0);
  expect((await request.get(`/api/v1/admin/support-tickets/${incident.ticket_id}`, { headers: bearer(supportToken) })).status()).toBe(404);

  const superadmin = await createFixtureUser();
  await grantPlatformRole(superadmin.id, "SUPERADMIN");
  const sa = await nativeSignIn(superadmin.email);
  const saToken = await stepUpToAal2(sa.client);
  expect((await request.get(`/api/v1/admin/support-tickets/${incident.ticket_id}`, { headers: bearer(saToken) })).status()).toBe(200);
});
