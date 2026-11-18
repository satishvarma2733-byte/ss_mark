// M4.3 partner operations in a real browser against the local stack: onboarding through review to a public listing,
// the closure conflict recovery, and staff invitations. Fictional data only.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  TINY_PNG, apiPost, completeMfaEnrolment, deliverInvitationLink, evidence, createFixtureUser, createQuickVenue, db, grantPlatformRole, holdThroughApi,
  istSlot, payOnMockGateway, signInWithEmailCode, signInWithMfa, signedInCustomer
} from "./helpers";

test("a new partner applies, configures and submits; an admin approves and the listing goes live with its photo", async ({ page, browser, request }) => {
  const owner = await createFixtureUser();
  await page.goto("/sign-in?redirect_path=/partner");
  await signInWithEmailCode(page, owner.email);
  await page.getByTestId("partner-apply-link").click();
  const suffix = randomUUID().slice(0, 6);
  await page.getByLabel("Registered business name").fill(`E2E Hospitality ${suffix} (fictional)`);
  await page.getByLabel("Venue name customers will see").fill(`E2E Partner Cafe ${suffix}`);
  await page.getByLabel("Street address").fill("12 Fictional Lane, Koramangala");
  await page.getByRole("checkbox", { name: /authorised to represent/ }).check();
  await evidence(page, "web-m43-01-apply");
  await page.getByTestId("apply-submit").click();

  // Partner tools need TOTP.
  await completeMfaEnrolment(page);
  await expect(page.getByRole("heading", { name: "Venue" })).toBeVisible();
  await expect(page.getByTestId("publication-gaps")).toBeVisible();
  await evidence(page, "web-m43-02-venue-draft-gaps");

  await page.getByTestId("venue-description").fill("A quiet fictional cafe with good light, used only by automated tests.");
  await page.getByTestId("save-profile").click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  await page.getByLabel("Outside food details customers see").fill("Packaged snacks only (fictional).");
  await page.getByLabel("On arrival").fill("Show your booking code at the counter.");
  await page.getByLabel("House rules", { exact: true }).fill("Keep calls short and quiet.");
  await page.getByTestId("save-rules").click();
  await expect(page.getByText("Rules saved.")).toBeVisible();
  await page.getByTestId("tag-WORK").check();
  await page.getByTestId("save-catalogue").click();
  await expect(page.getByText("Amenities and uses saved.")).toBeVisible();

  await page.getByTestId("photo-file").setInputFiles({ name: "table.png", mimeType: "image/png", buffer: TINY_PNG });
  await page.getByTestId("photo-alt").fill("Window table in the afternoon");
  await page.getByTestId("photo-upload").click();
  await expect(page.getByTestId("partner-photos").getByRole("img", { name: "Window table in the afternoon" })).toBeVisible();
  const [owned] = await db()`select m.venue_id from public.venue_memberships m join public.profiles p on p.id = m.user_id
                             where p.auth_user_id = ${owner.id}::uuid and m.role = 'OWNER'`;
  const venueId = owned!.venue_id as string;
  const [media] = await db()`select id from public.venue_media where venue_id = ${venueId}::uuid`;
  // Pending photos are private: the public gets 404 (and so would a guessed Storage path).
  expect((await request.get(`/api/v1/media/${media!.id}`)).status()).toBe(404);

  await page.goto(`/partner/inventory?venue=${venueId}`);
  await page.getByTestId("new-table-label").fill("Window table");
  await page.getByTestId("new-table-capacity").fill("4");
  await page.getByTestId("new-table-price").fill("300");
  await page.getByTestId("add-table").click();
  await expect(page.getByTestId("table-Window table")).toBeVisible();
  for (let day = 0; day < 7; day += 1) await page.getByTestId(`open-${day}`).check();
  await page.getByTestId("save-hours").click();
  await expect(page.getByText("Opening hours saved.")).toBeVisible();
  await evidence(page, "web-m43-03-inventory");

  await page.goto(`/partner/venue?venue=${venueId}`);
  await page.getByTestId("submit-venue").click();
  await expect(page.getByText("Waiting for Simply Sit review")).toBeVisible();
  await evidence(page, "web-m43-04-venue-submitted");

  // Platform review in a separate session.
  const support = await createFixtureUser();
  await grantPlatformRole(support.id, "SUPPORT");
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signInWithMfa(admin, support.email, "/admin/venues");
  await admin.getByRole("link", { name: `E2E Partner Cafe ${suffix}` }).click();
  await expect(admin.getByTestId("decision-APPROVE")).toBeVisible();
  await evidence(admin, "web-m43-05-admin-review");
  await admin.getByTestId("decision-APPROVE").check();
  await admin.getByTestId("review-reason").fill("Evidence checked (e2e)");
  await admin.getByTestId("review-submit").click();
  await expect(admin.getByTestId("admin-venue-status")).toContainText("Live");
  await adminContext.close();

  const [venue] = await db()`select slug, status from public.venues where id = ${venueId}::uuid`;
  expect(venue!.status).toBe("PUBLISHED");
  const photo = await request.get(`/api/v1/media/${media!.id}`);
  expect(photo.status()).toBe(200);
  expect(photo.headers()["content-type"]).toBe("image/png");
  const visitor = await browser.newContext();
  const pub = await visitor.newPage();
  await pub.goto(`/venues/${venue!.slug as string}`);
  await expect(pub.getByTestId("venue-photos").getByRole("img", { name: "Window table in the afternoon" })).toBeVisible();
  await evidence(pub, "web-m43-06-public-listing");
  await expect(pub.getByText("Packaged snacks only (fictional).")).toBeVisible();
  await visitor.close();
});

test("a closure over a paid booking is refused with its reference; pause, cancel for the customer, then block", async ({ page, browser }) => {
  const venue = await createQuickVenue({ tables: 1 });
  await signedInCustomer(page);
  // Tomorrow 11:00 IST, so the test does not depend on the time of day.
  const hold = await holdThroughApi(page, venue, 0, 0, istSlot(1, "11:00"));
  await page.goto(`/checkout/${hold.booking_id}`);
  await payOnMockGateway(page, "mock-pay-success");
  await expect(page.getByTestId("payment-title")).toHaveText("Booking confirmed");

  const manager = await createFixtureUser({ venueRole: { venueId: venue.venueId, role: "MANAGER" } });
  const ctx = await browser.newContext();
  const m = await ctx.newPage();
  await signInWithMfa(m, manager.email, `/partner/closures?venue=${venue.venueId}`);
  await expect(m.getByRole("heading", { name: /Close a table/ })).toBeVisible();
  const [b] = await db()`select start_at from public.bookings where id = ${hold.booking_id}::uuid`;
  const ist = new Date((b!.start_at as Date).getTime() + 330 * 60_000).toISOString();
  await m.getByTestId("closure-date").fill(ist.slice(0, 10));
  await m.getByTestId("closure-from").fill(ist.slice(11, 16));
  await m.getByTestId("closure-until").fill("23:50");
  await m.getByTestId("closure-reason").fill("Floor repair (e2e)");
  await m.getByTestId("add-closure").click();
  await expect(m.getByTestId("conflicts")).toContainText(hold.public_ref);
  await evidence(m, "web-m43-07-closure-conflict");

  await m.goto(`/partner/inventory?venue=${venue.venueId}`);
  await m.getByTestId("pause-reason-Quick table 1").fill("Floor repair (e2e)");
  await m.getByTestId("pause-Quick table 1").click();
  await expect(m.getByText("New bookings for this table are paused.")).toBeVisible();

  await m.goto(`/partner/bookings/${hold.booking_id}`);
  await m.getByTestId("service-cancel-reason").fill("Floor repair (e2e)");
  await m.getByTestId("service-cancel").click();
  await expect(m.getByTestId("service-cancel-message")).toHaveText("Cancelled. A full refund has been requested.");
  await evidence(m, "web-m43-08-service-cancel");

  await m.goto(`/partner/closures?venue=${venue.venueId}`);
  await m.getByTestId("closure-date").fill(ist.slice(0, 10));
  await m.getByTestId("closure-from").fill(ist.slice(11, 16));
  await m.getByTestId("closure-until").fill("23:50");
  await m.getByTestId("closure-reason").fill("Floor repair (e2e)");
  await m.getByTestId("add-closure").click();
  await expect(m.getByText("Closure applied.")).toBeVisible();
  await expect(m.getByTestId("closures")).toContainText("Floor repair (e2e)");
  await m.goto(`/partner/calendar?venue=${venue.venueId}&date=${istSlot(1, "11:00").slice(0, 10)}`);
  await evidence(m, "web-m43-09-calendar");

  // The customer sees why, and the full refund in progress.
  await page.goto(`/bookings/${hold.booking_id}`);
  await expect(page.getByTestId("cancelled-notice")).toContainText("the table is unavailable");

  // Staff invitation: the invited email signs in from the emailed link and accepts (M5.1 review F1: the link's token
  // is required; signing in with the invited address alone only lists the invitation).
  await m.goto(`/partner/staff?venue=${venue.venueId}`);
  const staff = await createFixtureUser();
  await m.getByTestId("invite-email").fill(staff.email);
  await m.getByTestId("invite-send").click();
  await expect(m.getByTestId("open-invitations")).toContainText(staff.email);
  await evidence(m, "web-m43-10-staff");
  await ctx.close();
  const [invite] = await db()`select id from public.venue_invitations where venue_id = ${venue.venueId}::uuid and email = ${staff.email}`;
  const acceptLink = await deliverInvitationLink(invite!.id as string);

  const staffCtx = await browser.newContext();
  const s = await staffCtx.newPage();
  await s.goto("/sign-in?redirect_path=/partner");
  await signInWithEmailCode(s, staff.email);
  await expect(s.getByTestId("invitations")).toContainText("invited you as staff");
  await expect(s.getByTestId(`use-link-${invite!.id as string}`)).toBeVisible();
  await expect(s.getByRole("button", { name: "Accept" })).toHaveCount(0);
  await s.goto(acceptLink);
  await evidence(s, "web-m43-11-invitation");
  await s.getByRole("button", { name: "Accept" }).click();
  await expect(s.getByTestId("portal-mfa-required")).toBeVisible();
  const [membership] = await db()`select m.role, m.status from public.venue_memberships m join public.profiles p on p.id = m.user_id
                                  where m.venue_id = ${venue.venueId}::uuid and p.auth_user_id = ${staff.id}::uuid`;
  expect(membership).toEqual({ role: "STAFF", status: "ACTIVE" });
  await staffCtx.close();
});

test("partner APIs show customers nothing about a venue they do not manage", async ({ page }) => {
  const venue = await createQuickVenue({ tables: 1 });
  await signedInCustomer(page);
  const forbidden = await apiPost(page, `/api/v1/partner/venues/${venue.venueId}/resources`, { label: "Mine now", capacity: 2, hourly_paise: 100 },
    { "idempotency-key": randomUUID() });
  expect(forbidden.status).toBe(404); // membership is checked before TOTP, so a non-member learns nothing
  expect(forbidden.body.error?.code).toBe("NOT_FOUND");
  const overview = await page.request.get(`/api/v1/partner/venues/${venue.venueId}`);
  expect(overview.status()).toBe(404);
  const quote = await apiPost(page, "/api/v1/quotes", {
    venue_id: venue.venueId, resource_id: venue.tableIds[0], start_at: istSlot(1, "15:00"), duration_minutes: 60, party_size: 2
  });
  expect(quote.status).toBe(201);
});
