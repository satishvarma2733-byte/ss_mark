// M4.3 partner operations on real PostgreSQL (docs/07 s.4; docs/03 P01-P08, A02; docs/08 T12, T14).
// Partner writes need the venue's MANAGER/OWNER with TOTP; staff get FORBIDDEN, everyone else NOT_FOUND. Inventory
// changes refuse (409 with references) rather than invalidate holds or bookings; nothing is cancelled silently.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptInvitation, adminReviewVenue, asAnon, asUser, asWorker, createQuote, createVenueClosure, invitationDelivery, mediaObject,
  myInvitations, partnerAddMedia, partnerApply, partnerBookingDetail, partnerCalendar, partnerCreateResource, partnerInvite,
  partnerReleaseClosure, partnerRevokeInvitation, partnerRevokeMember, partnerSavePolicyDraft, partnerSetAmenitiesTags, partnerSetHours, partnerSetRate,
  partnerSetResourceStatus, partnerStaff, partnerSubmitVenue, partnerUpdateResource, partnerUpdateVenue, partnerVenueOverview,
  recordInvitationToken, serviceCancelBooking, staffCheckIn, staffMarkNoShow, venuePhotos, type Sql
} from "@simply-sit/db";
import { arrivalCodes, invitationToken, invitationTokenHash } from "@simply-sit/domain";
import { applyPayment, startCheckout } from "@simply-sit/payments";
import { loadArrivalSecret } from "@simply-sit/providers";
import {
  claimsFor, createUser, createVenue, expectDomainError, grantPlatformRole, grantVenueRole, holdTable, istSlot, nextGridSlot, openDb,
  paymentServices, type TestUser, type TestVenue
} from "./helpers";

let sql: Sql;
let support: TestUser;
let customer: TestUser;

beforeAll(async () => {
  sql = openDb(20);
  [support, customer] = [await createUser(sql), await createUser(sql)];
  await grantPlatformRole(sql, support, "SUPPORT");
});
afterAll(async () => {
  await sql.end();
});

const as = (user: TestUser, aal: "aal1" | "aal2" = "aal2") => <T>(work: Parameters<typeof asUser<T>>[2]) => asUser(sql, claimsFor(user, { aal }), work);
const allWeek = (opens: string, closes: string) => Array.from({ length: 7 }, (_, weekday) => ({ weekday, opens_local: opens, closes_local: closes }));
const venueVersion = async (venueId: string) =>
  Number((await sql`select version from public.venues where id = ${venueId}::uuid`)[0]!.version);
const resourceVersion = async (id: string) => Number((await sql`select version from public.resources where id = ${id}::uuid`)[0]!.version);

// A new partner venue configured through the partner functions up to (not including) submission.
async function configuredVenue(owner: TestUser, opts: { photo?: boolean } = {}) {
  const applied = await as(owner)((tx) => partnerApply(tx, {
    partner_legal_name: "TEST Partner Pvt Ltd (fictional)", venue_name: "TEST Partner Cafe", category_code: "CAFE",
    address: "1 Test Road (fictional)", locality: "Koramangala (fictional)", lat: 12.935, lng: 77.62
  }));
  const venueId = applied.venue_id as string;
  await as(owner)((tx) => partnerUpdateVenue(tx, venueId, { description: "A calm fictional cafe for integration tests only." },
                                             applied.version as number));
  await as(owner)((tx) => partnerSavePolicyDraft(tx, venueId, { byo_food: "RESTRICTED", byo_details: "Packaged snacks only (test)." }));
  const table = await as(owner)((tx) => partnerCreateResource(tx, venueId, { label: "Window table", capacity: 4, hourly_paise: 30000 }));
  await as(owner)(async (tx) => partnerSetHours(tx, venueId, allWeek("08:00", "22:00"), await venueVersion(venueId)));
  await as(owner)(async (tx) => partnerSetAmenitiesTags(tx, venueId, {
    amenities: [{ code: "WIFI" }, { code: "ACCESSIBLE_ENTRANCE", details: "Step-free entrance (test)" }],
    tags: [{ group: "REQUIREMENT", code: "WORK" }, { group: "ENVIRONMENT", code: "QUIET" }],
    expected_version: await venueVersion(venueId)
  }));
  const mediaId = crypto.randomUUID();
  if (opts.photo !== false) {
    await as(owner)((tx) => partnerAddMedia(tx, venueId, mediaId, `${venueId}/${mediaId}.jpg`, "Window table in daylight"));
  }
  return { venueId, tableId: table.resource_id as string, mediaId };
}

async function publishedVenue(owner: TestUser) {
  const v = await configuredVenue(owner);
  await as(owner)(async (tx) => partnerSubmitVenue(tx, v.venueId, await venueVersion(v.venueId)));
  await as(support)(async (tx) => adminReviewVenue(tx, v.venueId, { decision: "APPROVE", reason: "Checked (test)", expected_version: await venueVersion(v.venueId) }));
  return v;
}

describe("onboarding and review (P01, P03, P04, A02)", () => {
  it("takes a new partner from application to a bookable, reviewed venue", async () => {
    const owner = await createUser(sql);
    const { venueId, tableId, mediaId } = await configuredVenue(owner, { photo: false });
    const overview = await as(owner)((tx) => partnerVenueOverview(tx, venueId));
    expect(overview).toMatchObject({ role: "OWNER", venue: { status: "DRAFT" }, publication_gaps: ["photo"] });

    const missing = await expectDomainError(as(owner)(async (tx) => partnerSubmitVenue(tx, venueId, await venueVersion(venueId))), "VALIDATION_FAILED");
    expect(missing).toMatchObject({ reason: "incomplete", missing: ["photo"] });
    await as(owner)((tx) => partnerAddMedia(tx, venueId, mediaId, `${venueId}/${mediaId}.jpg`, "Window table in daylight"));
    const submitted = await as(owner)(async (tx) => partnerSubmitVenue(tx, venueId, await venueVersion(venueId)));
    expect(submitted).toMatchObject({ status: "PENDING_REVIEW" });

    // Not public yet: no quote, no photo for the public.
    const slot = istSlot(3, "10:00");
    await expectDomainError(as(customer, "aal1")((tx) =>
      createQuote(tx, { venue_id: venueId, resource_id: tableId, start_at: slot, duration_minutes: 60, party_size: 2 })), "NOT_FOUND");
    await expectDomainError(asAnon(sql, (tx) => mediaObject(tx, mediaId)), "NOT_FOUND");
    // Managers can see their pending photo; storage write rules follow the same membership + TOTP check.
    expect(await as(owner)((tx) => mediaObject(tx, mediaId))).toMatchObject({ public: false });
    const writable = (user: TestUser, aal: "aal1" | "aal2") => as(user, aal)((tx) =>
      tx`select app.media_object_writable(${`${venueId}/${crypto.randomUUID()}.png`}) as ok`.then((r) => r[0]!.ok as boolean));
    expect(await writable(owner, "aal2")).toBe(true);
    expect(await writable(owner, "aal1")).toBe(false);
    expect(await writable(customer, "aal2")).toBe(false);

    const approved = await as(support)(async (tx) =>
      adminReviewVenue(tx, venueId, { decision: "APPROVE", reason: "Evidence checked (test)", expected_version: await venueVersion(venueId) }));
    expect(approved).toMatchObject({ status: "PUBLISHED" });
    const [state] = await sql`
      select v.status, p.status as policy_status, p.byo_food, pa.status as partner_status, m.status as media_status
      from public.venues v join public.venue_policies p on p.id = v.active_policy_id join public.partners pa on pa.id = v.partner_id
      join public.venue_media m on m.venue_id = v.id where v.id = ${venueId}::uuid`;
    expect(state).toEqual({ status: "PUBLISHED", policy_status: "PUBLISHED", byo_food: "RESTRICTED", partner_status: "APPROVED", media_status: "APPROVED" });
    expect(await asAnon(sql, (tx) => venuePhotos(tx, venueId))).toEqual([{ id: mediaId, alt_text: "Window table in daylight" }]);
    expect(await asAnon(sql, (tx) => mediaObject(tx, mediaId))).toMatchObject({ public: true });

    const quote = await as(customer, "aal1")((tx) =>
      createQuote(tx, { venue_id: venueId, resource_id: tableId, start_at: slot, duration_minutes: 60, party_size: 2 }));
    expect(quote.price_snapshot.base_paise).toBe(30000);
    expect(quote.policy_snapshot).toMatchObject({ byo_food: "RESTRICTED", cancel_cutoff_minutes: 120 });
    const audit = await sql`select action from public.audit_events where venue_id = ${venueId}::uuid order by created_at`;
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["partner.apply", "venue.submit", "venue.review"]));
  });

  it("sends a venue back with a reason, accepts resubmission, and can pause and resume a live venue", async () => {
    const owner = await createUser(sql);
    const { venueId } = await configuredVenue(owner);
    await as(owner)(async (tx) => partnerSubmitVenue(tx, venueId, await venueVersion(venueId)));
    await expectDomainError(as(owner)(async (tx) => partnerUpdateVenue(tx, venueId, { name: "Renamed" }, await venueVersion(venueId))), "INVALID_TRANSITION");
    // The terms under review are frozen: the reviewer approves exactly what was submitted.
    const frozen = await expectDomainError(as(owner)((tx) => partnerSavePolicyDraft(tx, venueId, { early_refund_bps: 0 })), "INVALID_TRANSITION");
    expect(frozen).toMatchObject({ reason: "venue_in_review" });
    await as(support)(async (tx) =>
      adminReviewVenue(tx, venueId, { decision: "REQUEST_CHANGES", reason: "Add a clearer photo (test)", expected_version: await venueVersion(venueId) }));
    expect(await as(owner)((tx) => partnerVenueOverview(tx, venueId))).toMatchObject({
      venue: { status: "DRAFT", status_reason: "Add a clearer photo (test)" }
    });
    await as(owner)(async (tx) => partnerSubmitVenue(tx, venueId, await venueVersion(venueId)));
    await as(support)(async (tx) => adminReviewVenue(tx, venueId, { decision: "APPROVE", reason: "OK now (test)", expected_version: await venueVersion(venueId) }));
    const paused = await as(support)(async (tx) =>
      adminReviewVenue(tx, venueId, { decision: "PAUSE", reason: "Safety check (test)", expected_version: await venueVersion(venueId) }));
    expect(paused).toMatchObject({ status: "PAUSED", affected_bookings: [] });
    await as(support)(async (tx) => adminReviewVenue(tx, venueId, { decision: "RESUME", reason: "Cleared (test)", expected_version: await venueVersion(venueId) }));
    expect((await sql`select status from public.venues where id = ${venueId}::uuid`)[0]).toEqual({ status: "PUBLISHED" });
  });

  it("keeps partner and admin actions to the right people", async () => {
    const owner = await createUser(sql);
    const [staff, outsider] = [await createUser(sql), await createUser(sql)];
    const { venueId } = await configuredVenue(owner);
    await grantVenueRole(sql, venueId, staff, "STAFF");
    const v = await venueVersion(venueId);
    await expectDomainError(as(staff)((tx) => partnerUpdateVenue(tx, venueId, { name: "Hijack" }, v)), "FORBIDDEN");
    await expectDomainError(as(outsider)((tx) => partnerUpdateVenue(tx, venueId, { name: "Hijack" }, v)), "NOT_FOUND");
    await expectDomainError(as(owner, "aal1")((tx) => partnerUpdateVenue(tx, venueId, { name: "No TOTP" }, v)), "REAUTH_REQUIRED");
    await expectDomainError(as(owner)((tx) => partnerUpdateVenue(tx, venueId, { status: "PUBLISHED" }, v)), "VALIDATION_FAILED");
    await expectDomainError(as(owner)((tx) => partnerSavePolicyDraft(tx, venueId, { venue_cancel_refund_bps: 0 })), "VALIDATION_FAILED");
    await expectDomainError(as(owner)((tx) => partnerSavePolicyDraft(tx, venueId, { increment_minutes: 7 })), "VALIDATION_FAILED");
    await as(owner)(async (tx) => partnerSubmitVenue(tx, venueId, await venueVersion(venueId)));
    await expectDomainError(as(owner)(async (tx) =>
      adminReviewVenue(tx, venueId, { decision: "APPROVE", reason: "Self approval", expected_version: await venueVersion(venueId) })), "FORBIDDEN");
    await expectDomainError(as(support, "aal1")(async (tx) =>
      adminReviewVenue(tx, venueId, { decision: "APPROVE", reason: "No TOTP", expected_version: await venueVersion(venueId) })), "REAUTH_REQUIRED");
    await expectDomainError(as(staff)((tx) => partnerVenueOverview(tx, venueId)), "FORBIDDEN");
  });
});

describe("inventory changes never invalidate existing commitments (P04, T12)", () => {
  let owner: TestUser;
  let venue: { venueId: string; tableId: string };
  let testVenue: TestVenue;

  beforeAll(async () => {
    owner = await createUser(sql);
    venue = await publishedVenue(owner);
    testVenue = { venueId: venue.venueId, tableIds: [venue.tableId], slug: "", partnerId: "", policyId: "" };
  });

  it("applies a new rate to new quotes only; the old price stays on existing bookings", async () => {
    const before = await holdTable(sql, customer, testVenue, istSlot(2, "09:00"), { party: 2 });
    const from = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10) + "T00:00:00.000Z";
    await as(owner)(async (tx) => partnerSetRate(tx, venue.tableId, { hourly_paise: 45000, effective_from: from, expected_version: await resourceVersion(venue.tableId) }));
    await expectDomainError(as(owner)(async (tx) =>
      partnerSetRate(tx, venue.tableId, { hourly_paise: 50000, effective_from: from, expected_version: await resourceVersion(venue.tableId) })), "INVALID_TRANSITION");
    const quoteAt = (start: string) => as(customer, "aal1")((tx) =>
      createQuote(tx, { venue_id: venue.venueId, resource_id: venue.tableId, start_at: start, duration_minutes: 60, party_size: 2 }));
    expect((await quoteAt(istSlot(1, "12:00"))).price_snapshot.base_paise).toBe(30000);
    expect((await quoteAt(istSlot(4, "12:00"))).price_snapshot.base_paise).toBe(45000);
    const [b] = await sql`select total_paise from public.bookings where id = ${before.booking_id}::uuid`;
    expect(Number(b!.total_paise)).toBe(30000);
  });

  it("refuses to shrink capacity or hours under a booked party, listing the booking", async () => {
    const hold = await holdTable(sql, customer, testVenue, istSlot(5, "10:00"), { party: 4 });
    const capacity = await expectDomainError(as(owner)(async (tx) =>
      partnerUpdateResource(tx, venue.tableId, { capacity: 2, expected_version: await resourceVersion(venue.tableId) })), "SLOT_UNAVAILABLE");
    expect(capacity).toMatchObject({ reason: "capacity_conflict", conflicts: [expect.objectContaining({ public_ref: hold.public_ref })] });
    const hours = await expectDomainError(as(owner)(async (tx) =>
      partnerSetHours(tx, venue.venueId, allWeek("12:00", "22:00"), await venueVersion(venue.venueId))), "SLOT_UNAVAILABLE");
    expect(hours).toMatchObject({ reason: "hours_conflict" });
    expect((hours.conflicts as { public_ref: string }[]).map((c) => c.public_ref)).toContain(hold.public_ref);
    const ok = await as(owner)(async (tx) => partnerSetHours(tx, venue.venueId, allWeek("07:00", "23:00"), await venueVersion(venue.venueId)));
    expect(ok.schedule_version).toBeGreaterThan(1);
    const widened = await as(owner)(async (tx) =>
      partnerUpdateResource(tx, venue.tableId, { capacity: 6, expected_version: await resourceVersion(venue.tableId) }));
    expect(widened).toMatchObject({ capacity: 6 });
  });

  it("runs the closure recovery: conflict -> pause sales -> service-cancel -> closure saved -> released", async () => {
    const start = istSlot(7, "15:00");
    const hold = await holdTable(sql, customer, testVenue, start, { party: 2 });
    const s = paymentServices(sql);
    const { order } = await startCheckout(s, claimsFor(customer), { bookingId: hold.booking_id, expectedVersion: hold.version }, crypto.randomUUID());
    await applyPayment(s, order, await s.gateway.simulatePayment(order.provider_order_id!, "capture"), "VERIFY");

    const end = new Date(Date.parse(start) + 4 * 3_600_000).toISOString();
    const closure = { resource_ids: [venue.tableId], start_at: new Date(Date.parse(start) - 3_600_000).toISOString(), end_at: end, reason: "Floor repair (test)" };
    const conflict = await expectDomainError(as(owner)((tx) => createVenueClosure(tx, venue.venueId, closure)), "SLOT_UNAVAILABLE");
    expect(conflict).toMatchObject({ reason: "closure_conflict", conflicts: [expect.objectContaining({ public_ref: hold.public_ref, booking_status: "CONFIRMED" })] });

    const paused = await as(owner)(async (tx) =>
      partnerSetResourceStatus(tx, venue.tableId, "PAUSE", { reason: "Floor repair (test)", expected_version: await resourceVersion(venue.tableId) }));
    expect(paused).toMatchObject({ status: "PAUSED", future_commitments: expect.arrayContaining([expect.objectContaining({ public_ref: hold.public_ref })]) });
    // New sales stop at once; the paid booking is untouched until someone resolves it.
    await expectDomainError(holdTable(sql, customer, testVenue, istSlot(8, "11:00")), "SLOT_UNAVAILABLE");
    expect((await sql`select status from public.bookings where id = ${hold.booking_id}::uuid`)[0]).toEqual({ status: "CONFIRMED" });

    const [b] = await sql`select version from public.bookings where id = ${hold.booking_id}::uuid`;
    await as(owner)((tx) => serviceCancelBooking(tx, { booking_id: hold.booking_id, reason_code: "TABLE_UNAVAILABLE", reason: "Floor repair (test)", expected_version: b!.version as number }));
    const saved = await as(owner)((tx) => createVenueClosure(tx, venue.venueId, closure));
    expect(saved).toMatchObject({ closure_ids: [expect.any(String)] });
    const closureId = (saved.closure_ids as string[])[0]!;
    await expectDomainError(as(owner)((tx) => partnerReleaseClosure(tx, closureId, "x")), "VALIDATION_FAILED");
    await as(owner)((tx) => partnerReleaseClosure(tx, closureId, "Repair finished (test)"));
    expect((await sql`select active from public.inventory_claims where id = ${closureId}::uuid`)[0]).toEqual({ active: false });
    await as(owner)(async (tx) => partnerSetResourceStatus(tx, venue.tableId, "RESUME", { expected_version: await resourceVersion(venue.tableId) }));
    expect((await holdTable(sql, customer, testVenue, istSlot(8, "11:00"))).status).toBe("HOLD");
  });

  it("only lets the owner retire a table, and never one with future bookings", async () => {
    const extra = await as(owner)((tx) => partnerCreateResource(tx, venue.venueId, { label: "Corner table", capacity: 2, hourly_paise: 20000 }));
    const id = extra.resource_id as string;
    const manager = await createUser(sql);
    await grantVenueRole(sql, venue.venueId, manager, "MANAGER");
    await expectDomainError(as(manager)(async (tx) => partnerSetResourceStatus(tx, id, "RETIRE", { reason: "Removed (test)", expected_version: await resourceVersion(id) })), "FORBIDDEN");
    await holdTable(sql, customer, { ...testVenue, tableIds: [id] }, istSlot(9, "10:00"));
    await expectDomainError(as(owner)(async (tx) => partnerSetResourceStatus(tx, id, "RETIRE", { reason: "Removed (test)", expected_version: await resourceVersion(id) })), "SLOT_UNAVAILABLE");
  });
});

describe("staff invitations and roles (P08, T14)", () => {
  it("lets only the invited, signed-in email with the emailed link accept; managers invite staff, owners invite managers", async () => {
    const secret = loadArrivalSecret(process.env);
    const owner = await createUser(sql);
    const { venueId } = await configuredVenue(owner);
    const manager = await createUser(sql);
    await grantVenueRole(sql, venueId, manager, "MANAGER");
    const [invitee, stranger] = [await createUser(sql, { label: "invitee" }), await createUser(sql)];

    const invitation = await as(manager)((tx) => partnerInvite(tx, venueId, invitee.email.toUpperCase(), "STAFF"));
    expect(invitation).toMatchObject({ status: "INVITED", role: "STAFF", existing: false });
    expect(await as(manager)((tx) => partnerInvite(tx, venueId, invitee.email, "STAFF"))).toMatchObject({ existing: true });
    await expectDomainError(as(manager)((tx) => partnerInvite(tx, venueId, stranger.email, "MANAGER")), "FORBIDDEN");
    expect(await asWorker(sql, (tx) => invitationDelivery(tx, invitation.invitation_id as string))).toMatchObject({ email: invitee.email, status: "INVITED" });
    const [job] = await sql`select kind from public.outbox_jobs where business_key = ${`invitation:${invitation.invitation_id}:created`}`;
    expect(job).toEqual({ kind: "invitation.created" });

    // M5.1 review F1: accepting needs the emailed link's token as well as the invited, confirmed email. The worker
    // records the token's hash before sending; until then nothing can be accepted, and only the worker records it.
    const inviteId = invitation.invitation_id as string;
    const token = invitationToken(secret, inviteId);
    await expectDomainError(as(invitee, "aal1")((tx) => acceptInvitation(tx, inviteId, token)), "NOT_FOUND");
    await expectDomainError(as(manager)((tx) => recordInvitationToken(tx, inviteId, invitationTokenHash(secret, inviteId))), "42501");
    expect(await asWorker(sql, (tx) => recordInvitationToken(tx, inviteId, invitationTokenHash(secret, inviteId)))).toBe(true);
    expect(await asWorker(sql, (tx) => recordInvitationToken(tx, inviteId, invitationTokenHash(secret, inviteId)))).toBe(true);

    expect(await as(stranger, "aal1")((tx) => myInvitations(tx))).toEqual([]);
    // The link alone is not enough (another account), and neither is the invited address alone (a wrong token).
    await expectDomainError(as(stranger, "aal1")((tx) => acceptInvitation(tx, inviteId, token)), "NOT_FOUND");
    await expectDomainError(as(invitee, "aal1")((tx) => acceptInvitation(tx, inviteId, invitationToken("x".repeat(43), inviteId))), "NOT_FOUND");
    await expectDomainError(as(invitee, "aal1")((tx) => acceptInvitation(tx, inviteId, "not-a-token")), "NOT_FOUND");
    expect(await as(invitee, "aal1")((tx) => myInvitations(tx))).toEqual([expect.objectContaining({ venue_id: venueId, role: "STAFF" })]);
    expect(await as(invitee, "aal1")((tx) => acceptInvitation(tx, inviteId, token))).toMatchObject({ role: "STAFF", replayed: false });
    expect(await as(invitee, "aal1")((tx) => acceptInvitation(tx, inviteId, token))).toMatchObject({ replayed: true });
    // An accepted invitation takes no new token hash.
    expect(await asWorker(sql, (tx) => recordInvitationToken(tx, inviteId, invitationTokenHash(secret, inviteId)))).toBe(false);
    await expectDomainError(as(manager)((tx) => partnerInvite(tx, venueId, invitee.email, "STAFF")), "INVALID_TRANSITION");

    const owners = await as(owner)((tx) => partnerInvite(tx, venueId, stranger.email, "MANAGER"));
    const ownersId = owners.invitation_id as string;
    await asWorker(sql, (tx) => recordInvitationToken(tx, ownersId, invitationTokenHash(secret, ownersId)));
    await sql`update public.venue_invitations set expires_at = now() - interval '1 minute' where id = ${ownersId}::uuid`;
    await expectDomainError(as(stranger, "aal1")((tx) => acceptInvitation(tx, ownersId, invitationToken(secret, ownersId))), "INVITATION_EXPIRED");
    // The next invitation at the venue marks every stale one EXPIRED (the refused accept above wrote nothing).
    const third = await createUser(sql);
    const managerInvite = await as(owner)((tx) => partnerInvite(tx, venueId, third.email, "MANAGER"));
    expect((await sql`select status from public.venue_invitations where id = ${owners.invitation_id as string}::uuid`)[0]).toEqual({ status: "EXPIRED" });
    // Only an owner withdraws a manager invitation, as only an owner can send one.
    const ownerOnly = await expectDomainError(as(manager)((tx) => partnerRevokeInvitation(tx, managerInvite.invitation_id as string)), "FORBIDDEN");
    expect(ownerOnly).toMatchObject({ reason: "owner_only" });
    expect(await as(owner)((tx) => partnerRevokeInvitation(tx, managerInvite.invitation_id as string))).toMatchObject({ status: "REVOKED" });

    const staffList = await as(manager)((tx) => partnerStaff(tx, venueId));
    const staffRow = (staffList.members as { role: string; membership_id: string; version: number; email: string }[]).find((m) => m.email === invitee.email)!;
    const ownerRow = (staffList.members as { role: string; membership_id: string; version: number }[]).find((m) => m.role === "OWNER")!;
    await expectDomainError(as(manager)((tx) => partnerRevokeMember(tx, ownerRow.membership_id, ownerRow.version)), "FORBIDDEN");
    await expectDomainError(as(owner)((tx) => partnerRevokeMember(tx, ownerRow.membership_id, ownerRow.version)), "FORBIDDEN");
    await as(manager)((tx) => partnerRevokeMember(tx, staffRow.membership_id, staffRow.version));
    // Revocation applies before the next request: the former staff member sees nothing.
    await expectDomainError(as(invitee)((tx) => partnerCalendar(tx, venueId, new Date().toISOString(), new Date(Date.now() + 86_400_000).toISOString())), "NOT_FOUND");
  });
});

describe("calendar, booking detail and no-show (P05, P06)", () => {
  let venue: TestVenue;
  let staff: TestUser;
  let manager: TestUser;

  beforeAll(async () => {
    venue = await createVenue(sql, {
      tables: [{ capacity: 4, hourlyPaise: 30000 }, { capacity: 4, hourlyPaise: 30000 }],
      policy: { increment_minutes: 5, lead_minutes: 0 }, hours: { weekdays: [0, 1, 2, 3, 4, 5, 6], opens: "04:00", closes: "03:55" }
    });
    [staff, manager] = [await createUser(sql), await createUser(sql)];
    await grantVenueRole(sql, venue.venueId, staff, "STAFF");
    await grantVenueRole(sql, venue.venueId, manager, "MANAGER");
  });

  async function confirmed(table: number, start: string) {
    const hold = await holdTable(sql, customer, venue, start, { table });
    const s = paymentServices(sql);
    const { order } = await startCheckout(s, claimsFor(customer), { bookingId: hold.booking_id, expectedVersion: hold.version }, crypto.randomUUID());
    await applyPayment(s, order, await s.gateway.simulatePayment(order.provider_order_id!, "capture"), "VERIFY");
    return hold;
  }

  it("shows staff the day's bookings and closures without prices; managers see the total", async () => {
    const start = istSlot(3, "10:00");
    const hold = await confirmed(0, start);
    const from = new Date(Date.parse(start) - 3_600_000).toISOString();
    const to = new Date(Date.parse(start) + 3_600_000).toISOString();
    const calendar = await as(staff)((tx) => partnerCalendar(tx, venue.venueId, from, to));
    expect(calendar.bookings).toEqual([expect.objectContaining({ public_ref: hold.public_ref, status: "CONFIRMED" })]);
    expect(JSON.stringify(calendar)).not.toMatch(/total_paise|customer_id/);
    expect(calendar.can_manage).toBe(false);
    expect(await as(staff)((tx) => partnerBookingDetail(tx, hold.booking_id))).toMatchObject({ total_paise: null, can_manage: false });
    expect(await as(manager)((tx) => partnerBookingDetail(tx, hold.booking_id))).toMatchObject({ total_paise: 30000, can_manage: true });
    const other = await createUser(sql);
    await expectDomainError(as(other)((tx) => partnerBookingDetail(tx, hold.booking_id)), "NOT_FOUND");
  });

  it("records a no-show only after the grace period, once, keeping the paid interval allocated", async () => {
    const hold = await confirmed(1, nextGridSlot(5, 1));
    const version = async () => Number((await sql`select version from public.bookings where id = ${hold.booking_id}::uuid`)[0]!.version);
    const early = await expectDomainError(as(staff)(async (tx) => staffMarkNoShow(tx, hold.booking_id, await version())), "INVALID_TRANSITION");
    expect(early).toEqual({ reason: "grace_not_elapsed" });
    // Test-only clock travel: move the booking 20 minutes into the past (grace is 15) with triggers off for this statement.
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update public.bookings set start_at = now() - interval '20 minutes', end_at = now() + interval '40 minutes' where id = ${hold.booking_id}::uuid`;
    });
    const result = await as(staff)(async (tx) => staffMarkNoShow(tx, hold.booking_id, await version()));
    expect(result).toMatchObject({ status: "NO_SHOW", refund_paise: 0 });
    await expectDomainError(as(staff)(async (tx) => staffMarkNoShow(tx, hold.booking_id, await version())), "INVALID_TRANSITION");
    expect((await sql`select active from public.inventory_claims where booking_id = ${hold.booking_id}::uuid`)[0]).toEqual({ active: true });
    const codes = arrivalCodes(paymentServices(sql).arrivalSecret, hold.booking_id);
    expect(await as(staff)((tx) => staffCheckIn(tx, { venue_id: venue.venueId, qr_token: codes.qrToken, public_ref: null, pin: null }))).toEqual({ outcome: "INVALID" });
    const [job] = await sql`select kind from public.outbox_jobs where business_key = ${`booking:${hold.booking_id}:no_show`}`;
    expect(job).toEqual({ kind: "booking.no_show" });
  });
});
