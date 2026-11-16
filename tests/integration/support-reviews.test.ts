// M4.5 reviews, support tickets, confidential incidents and the admin booking lookup on real PostgreSQL
// (docs/03 C12, C13, A03, A04; docs/08 T14, T15). Reporters see only their own tickets and the customer-visible
// resolution; confidential tickets only superadmins and the assigned admin; contact reveal and email lookups are audited.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminBookingDetail, adminBookingSearch, adminReviewQueue, adminTicketContact, adminTicketDetail, adminTicketQueue, adminUpdateTicket,
  asAnon, asUser, createReview, createTicket, moderateReview, myTicket, myTickets, staffCheckIn, staffCheckOut, staffReportIncident,
  venueReviews, type Sql
} from "@simply-sit/db";
import { arrivalCodes } from "@simply-sit/domain";
import { applyPayment, startCheckout } from "@simply-sit/payments";
import {
  claimsFor, createUser, createVenue, expectDomainError, grantPlatformRole, grantVenueRole, holdTable, nextGridSlot, openDb, paymentServices,
  type TestUser, type TestVenue
} from "./helpers";

let sql: Sql;
let venue: TestVenue;
let otherVenue: TestVenue;
let staff: TestUser;
let otherStaff: TestUser;
let support: TestUser;
let support2: TestUser;
let superadmin: TestUser;
let finance: TestUser;

beforeAll(async () => {
  sql = openDb(20);
  const hours = { weekdays: [0, 1, 2, 3, 4, 5, 6], opens: "04:00", closes: "03:55" };
  venue = await createVenue(sql, { tables: Array.from({ length: 12 }, () => ({ capacity: 4, hourlyPaise: 30000 })), policy: { increment_minutes: 5, lead_minutes: 0 }, hours });
  otherVenue = await createVenue(sql, { policy: { increment_minutes: 5, lead_minutes: 0 }, hours });
  [staff, otherStaff, support, support2, superadmin, finance] = await Promise.all(Array.from({ length: 6 }, () => createUser(sql)));
  await grantVenueRole(sql, venue.venueId, staff, "STAFF");
  await grantVenueRole(sql, otherVenue.venueId, otherStaff, "STAFF");
  await grantPlatformRole(sql, support, "SUPPORT");
  await grantPlatformRole(sql, support2, "SUPPORT");
  await grantPlatformRole(sql, superadmin, "SUPERADMIN");
  await grantPlatformRole(sql, finance, "FINANCE");
});
afterAll(async () => {
  await sql.end();
});

const as = (user: TestUser, aal: "aal1" | "aal2" = "aal2") => <T>(work: Parameters<typeof asUser<T>>[2]) => asUser(sql, claimsFor(user, { aal }), work);
let nextTable = 0;

// A paid booking that starts now, optionally checked in and out (COMPLETED).
async function booking(complete = true) {
  const customer = await createUser(sql);
  const hold = await holdTable(sql, customer, venue, nextGridSlot(5, 1), { table: nextTable++ % venue.tableIds.length });
  const s = paymentServices(sql);
  const { order } = await startCheckout(s, claimsFor(customer), { bookingId: hold.booking_id, expectedVersion: hold.version }, crypto.randomUUID());
  await applyPayment(s, order, await s.gateway.simulatePayment(order.provider_order_id!, "capture"), "VERIFY");
  if (complete) {
    const codes = arrivalCodes(s.arrivalSecret, hold.booking_id);
    await as(staff)((tx) => staffCheckIn(tx, { venue_id: venue.venueId, qr_token: codes.qrToken, public_ref: null, pin: null }));
    const [row] = await sql`select version from public.bookings where id = ${hold.booking_id}::uuid`;
    await as(staff)((tx) => staffCheckOut(tx, hold.booking_id, row!.version as number));
  }
  return { customer, bookingId: hold.booking_id, publicRef: hold.public_ref };
}

describe("reviews (C12, T15)", () => {
  it("lets only the customer review a completed booking, once; support moderates; the venue shows published only", async () => {
    const open = await booking(false);
    await expectDomainError(as(open.customer, "aal1")((tx) => createReview(tx, open.bookingId, 5, "Great")), "INVALID_TRANSITION");
    const done = await booking();
    const stranger = await createUser(sql);
    await expectDomainError(as(stranger, "aal1")((tx) => createReview(tx, done.bookingId, 5, null)), "NOT_FOUND");
    await expectDomainError(as(done.customer, "aal1")((tx) => createReview(tx, done.bookingId, 6, null)), "VALIDATION_FAILED");
    const review = await as(done.customer, "aal1")((tx) => createReview(tx, done.bookingId, 4, "  Quiet corner, good light.  "));
    expect(review).toMatchObject({ rating: 4, body: "Quiet corner, good light.", moderation_status: "PENDING" });
    await expectDomainError(as(done.customer, "aal1")((tx) => createReview(tx, done.bookingId, 5, null)), "INVALID_TRANSITION");
    expect(await asAnon(sql, (tx) => venueReviews(tx, venue.venueId))).toMatchObject({ count: 0 });

    await expectDomainError(as(done.customer)((tx) => moderateReview(tx, review.review_id as string, { decision: "PUBLISH", expected_version: 1 })), "FORBIDDEN");
    await expectDomainError(as(support, "aal1")((tx) => moderateReview(tx, review.review_id as string, { decision: "PUBLISH", expected_version: 1 })), "REAUTH_REQUIRED");
    const queue = await as(support)((tx) => adminReviewQueue(tx, "PENDING"));
    expect(queue).toContainEqual(expect.objectContaining({ review_id: review.review_id }));
    await as(support)((tx) => moderateReview(tx, review.review_id as string, { decision: "PUBLISH", expected_version: 1 }));
    const published = await asAnon(sql, (tx) => venueReviews(tx, venue.venueId));
    expect(published).toMatchObject({ count: 1, average: 4, recent: [expect.objectContaining({ rating: 4, body: "Quiet corner, good light." })] });
    expect(JSON.stringify(published)).not.toMatch(/customer|booking/);

    await expectDomainError(as(support)((tx) => moderateReview(tx, review.review_id as string, { decision: "HIDE", expected_version: 2 })), "VALIDATION_FAILED");
    await as(support)((tx) => moderateReview(tx, review.review_id as string, { decision: "HIDE", reason: "Contains a phone number", expected_version: 2 }));
    expect(await asAnon(sql, (tx) => venueReviews(tx, venue.venueId))).toMatchObject({ count: 0 });
    const audit = await sql`select count(*)::int as n from public.audit_events where action = 'review.moderate' and entity_id = ${review.review_id as string}::uuid`;
    expect(audit[0]!.n).toBe(2);
  });
});

describe("support tickets (C13, A04)", () => {
  it("keeps tickets to their reporter; private notes never reach the reporter; resolution needs customer-visible text", async () => {
    const mine = await booking(false);
    const other = await booking(false);
    await expectDomainError(as(mine.customer, "aal1")((tx) => createTicket(tx, { booking_id: other.bookingId, category: "BOOKING", description: "Not my booking at all" })), "NOT_FOUND");
    await expectDomainError(as(mine.customer, "aal1")((tx) => createTicket(tx, { category: "BOOKING", description: "short" })), "VALIDATION_FAILED");
    const ticket = await as(mine.customer, "aal1")((tx) => createTicket(tx, { booking_id: mine.bookingId, category: "PAYMENT", description: "I was charged twice for this booking." }));
    expect(ticket).toMatchObject({ status: "OPEN", priority: "NORMAL", is_sensitive: false, booking_ref: mine.publicRef });
    expect(ticket.public_ref).toMatch(/^ST-[A-HJ-KM-NP-Z2-9]{8}$/);
    expect(await as(other.customer, "aal1")((tx) => myTickets(tx))).toEqual([]);
    await expectDomainError(as(other.customer, "aal1")((tx) => myTicket(tx, ticket.ticket_id as string)), "NOT_FOUND");

    const id = ticket.ticket_id as string;
    await expectDomainError(as(support)((tx) => adminUpdateTicket(tx, id, { status: "RESOLVED", expected_version: 1 })), "VALIDATION_FAILED");
    await as(support)((tx) => adminUpdateTicket(tx, id, { status: "IN_PROGRESS", assign_to: support.profileId, note: "Provider shows one capture (private).", expected_version: 1 }));
    await as(support)((tx) => adminUpdateTicket(tx, id, {
      status: "RESOLVED", customer_visible_resolution: "We checked with the provider: there was one charge only.", expected_version: 2
    }));
    const seen = await as(mine.customer, "aal1")((tx) => myTicket(tx, id));
    expect(seen).toMatchObject({ status: "RESOLVED", customer_visible_resolution: "We checked with the provider: there was one charge only." });
    expect(JSON.stringify(seen)).not.toMatch(/private|notes/);
    const detail = await as(support)((tx) => adminTicketDetail(tx, id));
    expect(detail.notes).toEqual([expect.objectContaining({ body: "Provider shows one capture (private).", by_me: true })]);
    await expectDomainError(as(mine.customer)((tx) => adminTicketDetail(tx, id)), "FORBIDDEN");
  });

  it("hides confidential safety tickets from unassigned support; superadmins assign; contact reveal is audited", async () => {
    const b = await booking(false);
    const safety = await as(b.customer, "aal1")((tx) => createTicket(tx, { booking_id: b.bookingId, category: "SAFETY", description: "Someone at the next table harassed me." }));
    expect(safety).toMatchObject({ is_sensitive: true, priority: "HIGH" });
    const id = safety.ticket_id as string;
    const queue = await as(support)((tx) => adminTicketQueue(tx, "OPEN"));
    expect(queue.tickets.map((t) => t.ticket_id)).not.toContain(id);
    expect(queue.restricted_count).toBeGreaterThanOrEqual(1);
    await expectDomainError(as(support)((tx) => adminTicketDetail(tx, id)), "NOT_FOUND");
    await expectDomainError(as(support)((tx) => adminTicketContact(tx, id, "Need to call the customer back")), "NOT_FOUND");
    await expectDomainError(as(support)((tx) => adminUpdateTicket(tx, id, { assign_to: support.profileId, expected_version: 1 })), "NOT_FOUND");

    await as(superadmin)((tx) => adminTicketDetail(tx, id));
    await as(superadmin)((tx) => adminUpdateTicket(tx, id, { assign_to: support.profileId, expected_version: 1 }));
    expect(await as(support)((tx) => adminTicketDetail(tx, id))).toMatchObject({ assigned_to_me: true, is_sensitive: true });
    await expectDomainError(as(support2)((tx) => adminTicketDetail(tx, id)), "NOT_FOUND");
    await expectDomainError(as(support)((tx) => adminUpdateTicket(tx, id, { assign_to: support2.profileId, expected_version: 2 })), "FORBIDDEN");

    await expectDomainError(as(support)((tx) => adminTicketContact(tx, id, "call")), "VALIDATION_FAILED");
    const contact = await as(support)((tx) => adminTicketContact(tx, id, "Customer asked for a call back about safety"));
    expect(contact.email).toBe(b.customer.email.toLowerCase());
    const [audit] = await sql`select reason from public.audit_events where action = 'ticket.contact_reveal' and entity_id = ${id}::uuid`;
    expect(audit).toEqual({ reason: "Customer asked for a call back about safety" });
  });

  it("lets venue staff report incidents only for their venue and see only their own reports", async () => {
    const b = await booking(false);
    await expectDomainError(as(staff, "aal1")((tx) => staffReportIncident(tx, { venue_id: venue.venueId, category: "SAFETY", description: "Broken glass near table 2.", sensitive: false })), "REAUTH_REQUIRED");
    await expectDomainError(as(otherStaff)((tx) => staffReportIncident(tx, { venue_id: venue.venueId, category: "VENUE", description: "Not my venue at all.", sensitive: false })), "NOT_FOUND");
    await expectDomainError(as(otherStaff)((tx) => staffReportIncident(tx, { venue_id: otherVenue.venueId, booking_id: b.bookingId, category: "BOOKING", description: "Booking from another venue.", sensitive: false })), "NOT_FOUND");
    const report = await as(staff)((tx) => staffReportIncident(tx, { venue_id: venue.venueId, booking_id: b.bookingId, category: "VENUE", description: "Guest left a bag at table 2.", sensitive: true }));
    expect(report).toMatchObject({ is_sensitive: true, booking_ref: b.publicRef });
    expect(await as(staff)((tx) => myTickets(tx))).toEqual([expect.objectContaining({ ticket_id: report.ticket_id })]);
    expect(await as(b.customer, "aal1")((tx) => myTickets(tx))).toEqual([]);
    const [audit] = await sql`select actor_role from public.audit_events where action = 'incident.report' and entity_id = ${report.ticket_id as string}::uuid`;
    expect(audit).toEqual({ actor_role: "VENUE_STAFF" });
  });
});

describe("admin booking lookup (A03a, A03)", () => {
  it("is limited to support/finance/superadmin with TOTP; email lookups and detail views are audited", async () => {
    const b = await booking();
    await expectDomainError(as(b.customer)((tx) => adminBookingSearch(tx, { ref: b.publicRef })), "FORBIDDEN");
    await expectDomainError(as(staff)((tx) => adminBookingSearch(tx, { ref: b.publicRef })), "FORBIDDEN");
    await expectDomainError(as(support, "aal1")((tx) => adminBookingSearch(tx, { ref: b.publicRef })), "REAUTH_REQUIRED");
    await expectDomainError(as(support)((tx) => adminBookingSearch(tx, {})), "VALIDATION_FAILED");
    expect(await as(support)((tx) => adminBookingSearch(tx, { ref: b.publicRef.toLowerCase() }))).toEqual([expect.objectContaining({ booking_id: b.bookingId })]);
    expect(await as(finance)((tx) => adminBookingSearch(tx, { email: b.customer.email.toUpperCase() }))).toEqual([expect.objectContaining({ booking_id: b.bookingId })]);
    expect(await as(finance)((tx) => adminBookingSearch(tx, { email: "nobody@example.test" }))).toEqual([]);
    const audits = await sql`select safe_diff from public.audit_events where action = 'booking.lookup_by_email' order by created_at desc limit 2`;
    expect(audits.map((a) => (a.safe_diff as { matched: boolean }).matched)).toEqual([false, true]);

    const detail = await as(support)((tx) => adminBookingDetail(tx, b.bookingId));
    expect(detail.booking).toMatchObject({ public_ref: b.publicRef, status: "COMPLETED" });
    expect((detail.events as { event_type: string }[]).map((e) => e.event_type)).toEqual(expect.arrayContaining(["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"]));
    expect(detail.payments).toEqual([expect.objectContaining({ attempts: [expect.objectContaining({ state: "CAPTURED", allocation_state: "BOOKING" })] })]);
    expect(JSON.stringify(detail)).not.toMatch(/checkin_|token|pin_hash/);
    const [view] = await sql`select count(*)::int as n from public.audit_events where action = 'booking.view' and entity_id = ${b.bookingId}::uuid`;
    expect(view!.n).toBe(1);
  });
});
