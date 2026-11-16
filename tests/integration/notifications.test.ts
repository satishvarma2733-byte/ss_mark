// M4.6 notifications and business metrics on real PostgreSQL (docs/01 PRD-11; docs/06 M4.6; docs/07 GET /notifications,
// GET /admin/metrics). In-app rows are durable and deduplicated per event; end reminders follow the committed end and
// are never a condition of a booking ending. Metrics are aggregates without personal data.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminBusinessMetrics, adminUpdateTicket, asUser, asWorker, beginExtensionCheckout, cancelBooking, cancelPreview, createReview, createTicket,
  decideExtension, holdExtension, jobNotifyBooking, markNotificationsRead, moderateReview, myNotificationPreferences, myNotifications, requestExtension, setNotificationPreferences, sendEndReminders,
  staffCheckIn, staffCheckOut, type Sql
} from "@simply-sit/db";
import { arrivalCodes } from "@simply-sit/domain";
import { applyPayment, ensureProviderOrder, startCheckout, submitRefund } from "@simply-sit/payments";
import {
  claimsFor, createUser, createVenue, expectDomainError, grantPlatformRole, grantVenueRole, holdTable, istSlot, nextGridSlot, openDb,
  paymentServices, type TestUser, type TestVenue
} from "./helpers";

let sql: Sql;
let venue: TestVenue;
let staff: TestUser;
let support: TestUser;
let finance: TestUser;

const hours = { weekdays: [0, 1, 2, 3, 4, 5, 6], opens: "04:00", closes: "03:55" };
const services = () => paymentServices(sql);

beforeAll(async () => {
  sql = openDb(20);
  // A reminder window longer than a booking plus a 30-minute extension, so a booking that starts now is inside it once
  // checked in, before and after the extension.
  venue = await createVenue(sql, {
    tables: Array.from({ length: 12 }, () => ({ capacity: 4, hourlyPaise: 30000 })), hours,
    policy: { increment_minutes: 5, lead_minutes: 0, end_reminder_minutes: 120 }
  });
  [staff, support, finance] = await Promise.all([createUser(sql), createUser(sql), createUser(sql)]);
  await grantVenueRole(sql, venue.venueId, staff, "STAFF");
  await grantPlatformRole(sql, support, "SUPPORT");
  await grantPlatformRole(sql, finance, "FINANCE");
});
afterAll(async () => {
  await sql.end();
});

const as = (user: TestUser, aal: "aal1" | "aal2" = "aal2") => <T>(work: Parameters<typeof asUser<T>>[2]) => asUser(sql, claimsFor(user, { aal }), work);
let nextTable = 0;

async function paidBooking(target: TestVenue = venue, startAt = nextGridSlot(5, 1)) {
  const customer = await createUser(sql);
  const hold = await holdTable(sql, customer, target, startAt, { table: target === venue ? nextTable++ : 0 });
  const s = services();
  const { order } = await startCheckout(s, claimsFor(customer), { bookingId: hold.booking_id, expectedVersion: hold.version }, crypto.randomUUID());
  await applyPayment(s, order, await s.gateway.simulatePayment(order.provider_order_id!, "capture"), "VERIFY");
  return { customer, bookingId: hold.booking_id, publicRef: hold.public_ref };
}

const version = async (bookingId: string) =>
  Number((await sql`select version from public.bookings where id = ${bookingId}::uuid`)[0]!.version);

async function checkIn(target: TestVenue, bookingId: string) {
  const codes = arrivalCodes(services().arrivalSecret, bookingId);
  await as(staff)((tx) => staffCheckIn(tx, { venue_id: target.venueId, qr_token: codes.qrToken, public_ref: null, pin: null }));
}

const checkOut = async (bookingId: string) => as(staff)(async (tx) => staffCheckOut(tx, bookingId, await version(bookingId)));

const notificationsFor = (bookingId: string, template: string) =>
  sql`select event_key, channel from public.notifications where booking_id = ${bookingId}::uuid and template = ${template}
      order by created_at, channel`;
const sweep = () => asWorker(sql, (tx) => sendEndReminders(tx, 500));

describe("inbox (PRD-11)", () => {
  it("records each event once per channel; only its owner sees it or marks it read", async () => {
    const b = await paidBooking();
    const key = `booking:${b.bookingId}:confirmed`;
    // A redelivered job writes nothing new: one row per channel and one email job (deduplicated by business key).
    await asWorker(sql, (tx) => jobNotifyBooking(tx, b.bookingId, key, "booking_confirmed"));
    await asWorker(sql, (tx) => jobNotifyBooking(tx, b.bookingId, key, "booking_confirmed"));
    expect((await notificationsFor(b.bookingId, "booking_confirmed")).map((r) => r.channel)).toEqual(["EMAIL", "IN_APP"]);
    const [{ jobs }] = (await sql`select count(*)::int as jobs from public.outbox_jobs where kind = 'notification.email'
                                  and safe_payload ->> 'notification_id' in (select id::text from public.notifications where event_key = ${key})`) as unknown as [{ jobs: number }];
    expect(jobs).toBe(1);

    const page = await as(b.customer, "aal1")((tx) => myNotifications(tx));
    expect(page).toMatchObject({ unread: 1, has_more: false, next_offset: null });
    expect(page.notifications[0]).toMatchObject({ template: "booking_confirmed", public_ref: b.publicRef, booking_id: b.bookingId, read_at: null });
    expect(page.notifications[0]!.venue_name).toContain("TEST Venue");
    const id = page.notifications[0]!.notification_id;

    const stranger = await createUser(sql);
    expect((await as(stranger, "aal1")((tx) => myNotifications(tx))).notifications).toHaveLength(0);
    await expectDomainError(as(stranger, "aal1")((tx) => markNotificationsRead(tx, id)), "NOT_FOUND");
    expect(await as(b.customer, "aal1")((tx) => markNotificationsRead(tx, id))).toEqual({ marked: 1, unread: 0 });
    expect(await as(b.customer, "aal1")((tx) => markNotificationsRead(tx, id))).toEqual({ marked: 0, unread: 0 });

    // Paging, newest first; "mark all" covers the rest.
    for (const event of ["refund_pending", "booking_cancelled", "booking_no_show"]) {
      await asWorker(sql, (tx) => jobNotifyBooking(tx, b.bookingId, `test:${b.bookingId}:${event}`, event));
    }
    const first = await as(b.customer, "aal1")((tx) => myNotifications(tx, 0, 2));
    expect(first).toMatchObject({ has_more: true, next_offset: 2, unread: 3 });
    expect(first.notifications.map((n) => n.template)).toEqual(["booking_no_show", "booking_cancelled"]);
    const second = await as(b.customer, "aal1")((tx) => myNotifications(tx, 2, 2));
    expect(second).toMatchObject({ has_more: false, next_offset: null });
    expect(second.notifications.map((n) => n.template)).toEqual(["refund_pending", "booking_confirmed"]);
    expect(await as(b.customer, "aal1")((tx) => markNotificationsRead(tx, null))).toEqual({ marked: 3, unread: 0 });
  });
});

describe("end reminders", () => {
  it("reminds a checked-in guest once per committed end, again after an extension, and never holds up check-out", async () => {
    const confirmedOnly = await paidBooking();
    const b = await paidBooking();
    await checkIn(venue, b.bookingId);
    await sweep();
    await sweep();
    expect(await notificationsFor(confirmedOnly.bookingId, "booking_ending")).toHaveLength(0);
    const first = await notificationsFor(b.bookingId, "booking_ending");
    expect(first.map((r) => r.channel)).toEqual(["EMAIL", "IN_APP"]);

    // Extension applied: the committed end moves, so the next sweep sends one reminder for the new end.
    const ext = await as(b.customer, "aal1")(async (tx) => requestExtension(tx, b.bookingId, 30, await version(b.bookingId))) as
      { extension_id: string; version: number; amount_paise: number };
    const approved = await as(staff)((tx) => decideExtension(tx, ext.extension_id, { decision: "APPROVE", expected_version: ext.version })) as
      { version: number };
    const held = await as(b.customer, "aal1")((tx) => holdExtension(tx, ext.extension_id, ext.amount_paise, approved.version)) as { version: number };
    const begun = await as(b.customer, "aal1")((tx) =>
      beginExtensionCheckout(tx, { extension_id: ext.extension_id, expected_version: held.version, provider: "mock", environment: "TEST" }));
    const order = await ensureProviderOrder(services(), begun);
    await applyPayment(services(), order, await services().gateway.simulatePayment(order.provider_order_id!, "capture"), "VERIFY");
    await sweep();
    await sweep();
    const afterExtension = await notificationsFor(b.bookingId, "booking_ending");
    expect(afterExtension.filter((r) => r.channel === "IN_APP")).toHaveLength(2);
    expect(new Set(afterExtension.map((r) => r.event_key)).size).toBe(2);

    await checkOut(b.bookingId);
    await sweep();
    expect(await notificationsFor(b.bookingId, "booking_ending")).toHaveLength(4);

    // A guest who leaves before any sweep ran still checks out normally: reminders are not part of ending.
    const quick = await paidBooking();
    await checkIn(venue, quick.bookingId);
    await checkOut(quick.bookingId);
    expect((await sql`select status from public.bookings where id = ${quick.bookingId}::uuid`)[0]).toEqual({ status: "COMPLETED" });
    await sweep();
    expect(await notificationsFor(quick.bookingId, "booking_ending")).toHaveLength(0);
  });
});

describe("refund, support and review notices", () => {
  it("tells the customer when the provider completes a refund", async () => {
    const b = await paidBooking(venue, istSlot(2, "12:00"));
    const terms = await as(b.customer, "aal1")((tx) => cancelPreview(tx, b.bookingId)) as { refund_paise: number };
    const cancelled = await as(b.customer, "aal1")(async (tx) => cancelBooking(tx, {
      booking_id: b.bookingId, reason_code: "CHANGE_OF_PLANS", expected_version: await version(b.bookingId), expected_refund_paise: terms.refund_paise
    })) as { refund_id: string };
    expect(await notificationsFor(b.bookingId, "refund_processed")).toHaveLength(0);
    expect(await submitRefund(services(), cancelled.refund_id)).toBe("PROCESSED");
    expect((await notificationsFor(b.bookingId, "refund_processed")).map((r) => r.channel)).toEqual(["EMAIL", "IN_APP"]);
  });

  it("tells whoever raised a ticket about a reply and its resolution, and a reviewer about moderation (in-app only)", async () => {
    const customer = await createUser(sql);
    const ticket = await as(customer, "aal1")((tx) => createTicket(tx, { category: "PAYMENT", description: "I was charged twice (test)." })) as
      { ticket_id: string; version: number };
    const replied = await as(support)((tx) => adminUpdateTicket(tx, ticket.ticket_id, {
      customer_visible_resolution: "We checked: there was one charge only (test).", status: "IN_PROGRESS", expected_version: ticket.version
    })) as { version: number };
    await as(support)((tx) => adminUpdateTicket(tx, ticket.ticket_id, { status: "RESOLVED", expected_version: replied.version }));
    const inbox = await as(customer, "aal1")((tx) => myNotifications(tx));
    expect(inbox.notifications.map((n) => [n.template, n.ticket_id])).toEqual([
      ["ticket_resolved", ticket.ticket_id], ["ticket_reply", ticket.ticket_id]
    ]);

    const b = await paidBooking();
    await checkIn(venue, b.bookingId);
    await checkOut(b.bookingId);
    const review = await as(b.customer, "aal1")((tx) => createReview(tx, b.bookingId, 4, "Good light (test).")) as
      { review_id: string; version: number };
    await as(support)((tx) => moderateReview(tx, review.review_id, { decision: "PUBLISH", expected_version: review.version }));
    expect((await notificationsFor(b.bookingId, "review_published")).map((r) => r.channel)).toEqual(["IN_APP"]);
  });
});

describe("business metrics (A06)", () => {
  it("gives admins aggregates for a venue and period; money only to finance; nothing personal", async () => {
    const metricsVenue = await createVenue(sql, { tables: [{ capacity: 4, hourlyPaise: 30000 }, { capacity: 4, hourlyPaise: 30000 }], hours,
                                                  policy: { increment_minutes: 5, lead_minutes: 0 } });
    await grantVenueRole(sql, metricsVenue.venueId, staff, "STAFF");
    const start = nextGridSlot(5, 1);
    const done = await paidBooking(metricsVenue, start);
    await checkIn(metricsVenue, done.bookingId);
    await checkOut(done.bookingId);
    const unpaid = await createUser(sql);
    await holdTable(sql, unpaid, metricsVenue, start, { table: 1 });

    const istDay = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);
    const query = { from: istDay(new Date().toISOString()), to: istDay(start), venue_id: metricsVenue.venueId };
    const days = query.from === query.to ? 1 : 2;

    const asSupport = await as(support)((tx) => adminBusinessMetrics(tx, query));
    expect(asSupport).toMatchObject({
      funnel: { holds: 2, paid: 1 },
      outcomes: { paid_bookings: 1, completed: 1, no_show: 0 },
      occupancy: { booked_minutes: 60, open_minutes: 2 * 1435 * days },
      repeat: { customers: 1, repeat_customers: 0 },
      reliability: { check_in_attempts: 1, check_in_failures: 0 },
      finance: null
    });
    const text = JSON.stringify(asSupport);
    for (const forbidden of ["@", done.customer.profileId, "lat", "lng", "email"]) expect(text).not.toContain(forbidden);

    const asFinance = await as(finance)((tx) => adminBusinessMetrics(tx, query));
    expect(asFinance.finance).toMatchObject({ collected_paise: 30000, refunded_paise: 0, reconciliation: expect.any(String) });

    await expectDomainError(as(staff)((tx) => adminBusinessMetrics(tx, query)), "FORBIDDEN");
    await expectDomainError(as(done.customer)((tx) => adminBusinessMetrics(tx, query)), "FORBIDDEN");
    await expectDomainError(as(support, "aal1")((tx) => adminBusinessMetrics(tx, query)), "REAUTH_REQUIRED");
    await expectDomainError(as(support)((tx) => adminBusinessMetrics(tx, { ...query, from: "2026-01-01" })), "VALIDATION_FAILED");
    await expectDomainError(as(support)((tx) => adminBusinessMetrics(tx, { ...query, venue_id: crypto.randomUUID() })), "NOT_FOUND");
  });
});

describe("notification preferences (Figma 94:22428)", () => {
  const channels = async (user: TestUser, key: string) =>
    (await sql`select channel from public.notifications where user_id = ${user.profileId}::uuid and event_key = ${key} order by channel`).map((r) => r.channel as string);
  const notify = (user: TestUser, key: string, template: string) => sql`select app.notify_user(${user.profileId}::uuid, null, ${key}, ${template})`;

  it("defaults to email copies on and marketing off; saving is per person", async () => {
    const [a, b] = await Promise.all([createUser(sql), createUser(sql)]);
    expect(await as(a)((tx) => myNotificationPreferences(tx))).toEqual({ email_copies: true, marketing: false, updated_at: null });
    const saved = await as(a)((tx) => setNotificationPreferences(tx, { email_copies: false, marketing: true }));
    expect(saved).toMatchObject({ email_copies: false, marketing: true });
    expect(saved.updated_at).not.toBeNull();
    expect(await as(b)((tx) => myNotificationPreferences(tx))).toMatchObject({ email_copies: true, marketing: false });
    // Saving again updates the same row.
    await as(a)((tx) => setNotificationPreferences(tx, { email_copies: true, marketing: false }));
    const rows = await sql`select count(*)::int as n from public.notification_preferences where user_id = ${a.profileId}::uuid`;
    expect(rows[0]!.n).toBe(1);
  });

  it("with email copies off, optional updates stay in the inbox without email; essential ones are still emailed", async () => {
    const [optedOut, standard] = await Promise.all([createUser(sql), createUser(sql)]);
    await as(optedOut)((tx) => setNotificationPreferences(tx, { email_copies: false, marketing: false }));
    const run = crypto.randomUUID();
    for (const template of ["booking_confirmed", "booking_ending", "review_published", "ticket_resolved"]) {
      await notify(optedOut, `pref:${run}:${template}`, template);
      expect(await channels(optedOut, `pref:${run}:${template}`), template).toEqual(["IN_APP"]);
      await notify(standard, `pref:${run}:${template}`, template);
      expect(await channels(standard, `pref:${run}:${template}`), template).toEqual(["EMAIL", "IN_APP"]);
    }
    for (const template of ["booking_cancelled", "refund_pending", "refund_delayed", "extension_approved", "ticket_reply"]) {
      await notify(optedOut, `pref:${run}:${template}`, template);
      expect(await channels(optedOut, `pref:${run}:${template}`), template).toEqual(["EMAIL", "IN_APP"]);
    }
    // Turning copies back on affects later events only; nothing is sent retroactively.
    await as(optedOut)((tx) => setNotificationPreferences(tx, { email_copies: true, marketing: false }));
    expect(await channels(optedOut, `pref:${run}:booking_confirmed`)).toEqual(["IN_APP"]);
    await notify(optedOut, `pref:${run}:later`, "booking_confirmed");
    expect(await channels(optedOut, `pref:${run}:later`)).toEqual(["EMAIL", "IN_APP"]);
  });

  it("the preferences table is not readable or writable directly by a signed-in user", async () => {
    const user = await createUser(sql);
    await as(user)((tx) => setNotificationPreferences(tx, { email_copies: false, marketing: false }));
    await expect(as(user)((tx) => tx`select * from public.notification_preferences`)).rejects.toThrow();
    await expect(as(user)((tx) => tx`update public.notification_preferences set marketing = true`)).rejects.toThrow();
  });
});
