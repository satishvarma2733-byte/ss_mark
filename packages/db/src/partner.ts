// Partner operations and venue review (M4.3). Thin wrappers: every rule lives in the app.* SECURITY DEFINER functions,
// which re-check the caller's venue membership/platform role and TOTP inside the same transaction.
import type postgres from "postgres";

type Tx = postgres.TransactionSql;
type Json = Record<string, unknown>;

async function callJson<T = Json>(query: postgres.PendingQuery<postgres.Row[]>): Promise<T> {
  const rows = await query;
  return rows[0]?.result as T;
}

export function partnerApply(
  tx: Tx,
  input: { partner_legal_name: string; venue_name: string; category_code: string; address: string; locality: string; lat: number; lng: number },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.partner_apply(${input.partner_legal_name}, ${input.venue_name}, ${input.category_code}, ${input.address},
                             ${input.locality}, ${input.lat}::double precision, ${input.lng}::double precision, ${requestId}::uuid) as result`);
}

export function partnerUpdateVenue(tx: Tx, venueId: string, fields: Json, expectedVersion: number, requestId: string | null = null) {
  return callJson(tx`
    select app.partner_update_venue(${venueId}::uuid, ${tx.json(fields as postgres.JSONValue)}, ${expectedVersion}::integer,
                                    ${requestId}::uuid) as result`);
}

export function partnerSavePolicyDraft(tx: Tx, venueId: string, fields: Json, requestId: string | null = null) {
  return callJson(tx`
    select app.partner_save_policy_draft(${venueId}::uuid, ${tx.json(fields as postgres.JSONValue)}, ${requestId}::uuid) as result`);
}

export function partnerSubmitPolicy(tx: Tx, venueId: string, policyId: string, expectedVersion: number, requestId: string | null = null) {
  return callJson(tx`
    select app.partner_submit_policy(${venueId}::uuid, ${policyId}::uuid, ${expectedVersion}::integer, ${requestId}::uuid) as result`);
}

export function partnerCreateResource(
  tx: Tx,
  venueId: string,
  input: { label: string; capacity: number; hourly_paise: number },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.partner_create_resource(${venueId}::uuid, ${input.label}, ${input.capacity}::integer, ${input.hourly_paise}::bigint,
                                       ${requestId}::uuid) as result`);
}

export function partnerUpdateResource(
  tx: Tx,
  resourceId: string,
  input: { label?: string | undefined; capacity?: number | undefined; expected_version: number },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.partner_update_resource(${resourceId}::uuid, ${input.label ?? null}, ${input.capacity ?? null}::integer,
                                       ${input.expected_version}::integer, ${requestId}::uuid) as result`);
}

export function partnerSetRate(
  tx: Tx,
  resourceId: string,
  input: { hourly_paise: number; effective_from?: string | undefined; expected_version: number },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.partner_set_rate(${resourceId}::uuid, ${input.hourly_paise}::bigint, ${input.effective_from ?? null}::text::timestamptz,
                                ${input.expected_version}::integer, ${requestId}::uuid) as result`);
}

export function partnerSetResourceStatus(
  tx: Tx,
  resourceId: string,
  action: "PAUSE" | "RESUME" | "RETIRE",
  input: { reason?: string | undefined; expected_version: number },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.partner_set_resource_status(${resourceId}::uuid, ${action}, ${input.reason ?? null}, ${input.expected_version}::integer,
                                           ${requestId}::uuid) as result`);
}

export function partnerSetHours(
  tx: Tx,
  venueId: string,
  periods: { weekday: number; opens_local: string; closes_local: string }[],
  expectedVersion: number,
  requestId: string | null = null
) {
  return callJson(tx`
    select app.partner_set_hours(${venueId}::uuid, ${tx.json(periods as postgres.JSONValue)}, ${expectedVersion}::integer,
                                 ${requestId}::uuid) as result`);
}

export function partnerSetAmenitiesTags(
  tx: Tx,
  venueId: string,
  input: { amenities: { code: string; details?: string | undefined }[]; tags: { group: string; code: string }[]; expected_version: number },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.partner_set_amenities_tags(${venueId}::uuid, ${tx.json(input.amenities as postgres.JSONValue)},
                                          ${tx.json(input.tags as postgres.JSONValue)}, ${input.expected_version}::integer,
                                          ${requestId}::uuid) as result`);
}

export function partnerAddMedia(tx: Tx, venueId: string, mediaId: string, storageKey: string, altText: string, requestId: string | null = null) {
  return callJson(tx`
    select app.partner_add_media(${venueId}::uuid, ${mediaId}::uuid, ${storageKey}, ${altText}, ${requestId}::uuid) as result`);
}

export function partnerRemoveMedia(tx: Tx, mediaId: string, requestId: string | null = null) {
  return callJson(tx`select app.partner_remove_media(${mediaId}::uuid, ${requestId}::uuid) as result`);
}

export function partnerSubmitVenue(tx: Tx, venueId: string, expectedVersion: number, requestId: string | null = null) {
  return callJson(tx`select app.partner_submit_venue(${venueId}::uuid, ${expectedVersion}::integer, ${requestId}::uuid) as result`);
}

export function partnerReleaseClosure(tx: Tx, closureId: string, reason: string, requestId: string | null = null) {
  return callJson(tx`select app.partner_release_closure(${closureId}::uuid, ${reason}, ${requestId}::uuid) as result`);
}

export function createVenueClosure(
  tx: Tx,
  venueId: string,
  input: { resource_ids: string[] | null; start_at: string; end_at: string; reason: string },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.create_closure(${venueId}::uuid, ${input.resource_ids}::uuid[], ${input.start_at}::timestamptz, ${input.end_at}::timestamptz,
                              ${input.reason}, ${requestId}::uuid) as result`);
}

export function partnerInvite(tx: Tx, venueId: string, email: string, role: "STAFF" | "MANAGER", requestId: string | null = null) {
  return callJson(tx`select app.partner_invite(${venueId}::uuid, ${email}, ${role}, ${requestId}::uuid) as result`);
}

export function myInvitations(tx: Tx) {
  return callJson<Json[]>(tx`select app.my_invitations() as result`);
}

// The token is the one in the invitation email's link (packages/domain invitation.ts); the database compares its hash.
export function acceptInvitation(tx: Tx, invitationId: string, token: string, requestId: string | null = null) {
  return callJson(tx`select app.accept_invitation(${invitationId}::uuid, ${token}, ${requestId}::uuid) as result`);
}

export function partnerRevokeMember(tx: Tx, membershipId: string, expectedVersion: number, requestId: string | null = null) {
  return callJson(tx`select app.partner_revoke_member(${membershipId}::uuid, ${expectedVersion}::integer, ${requestId}::uuid) as result`);
}

export function partnerRevokeInvitation(tx: Tx, invitationId: string, requestId: string | null = null) {
  return callJson(tx`select app.partner_revoke_invitation(${invitationId}::uuid, ${requestId}::uuid) as result`);
}

export function partnerStaff(tx: Tx, venueId: string) {
  return callJson(tx`select app.partner_staff(${venueId}::uuid) as result`);
}

export function invitationDelivery(tx: Tx, invitationId: string) {
  return callJson<{ email: string; status: string; venue_name: string; role: string } | null>(
    tx`select app.invitation_delivery(${invitationId}::uuid) as result`);
}

// Worker: stores the hash of the link token before the email goes out. False when the invitation is no longer open.
export function recordInvitationToken(tx: Tx, invitationId: string, tokenHash: string) {
  return callJson<boolean>(tx`select app.record_invitation_token(${invitationId}::uuid, ${tokenHash}) as result`);
}

export function partnerVenueOverview(tx: Tx, venueId: string) {
  return callJson(tx`select app.partner_venue_overview(${venueId}::uuid) as result`);
}

export function partnerCalendar(tx: Tx, venueId: string, from: string, to: string) {
  return callJson(tx`select app.partner_calendar(${venueId}::uuid, ${from}::timestamptz, ${to}::timestamptz) as result`);
}

export function partnerBookingDetail(tx: Tx, bookingId: string) {
  return callJson(tx`select app.partner_booking_detail(${bookingId}::uuid) as result`);
}

export function staffMarkNoShow(tx: Tx, bookingId: string, expectedVersion: number, requestId: string | null = null) {
  return callJson(tx`select app.staff_mark_no_show(${bookingId}::uuid, ${expectedVersion}::integer, ${requestId}::uuid) as result`);
}

export function adminReviewVenue(
  tx: Tx,
  venueId: string,
  input: { decision: string; reason: string; expected_version: number },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.admin_review_venue(${venueId}::uuid, ${input.decision}, ${input.reason}, ${input.expected_version}::integer,
                                  ${requestId}::uuid) as result`);
}

export function adminReviewPolicy(
  tx: Tx,
  policyId: string,
  input: { decision: string; reason: string; expected_version: number },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.admin_review_policy(${policyId}::uuid, ${input.decision}, ${input.reason}, ${input.expected_version}::integer,
                                   ${requestId}::uuid) as result`);
}

export function adminReviewMedia(tx: Tx, mediaId: string, decision: string, reason: string | null, requestId: string | null = null) {
  return callJson(tx`select app.admin_review_media(${mediaId}::uuid, ${decision}, ${reason}, ${requestId}::uuid) as result`);
}

export function adminVenueQueue(tx: Tx, status: string) {
  return callJson<Json[]>(tx`select app.admin_venue_queue(${status}) as result`);
}

export function adminVenueDetail(tx: Tx, venueId: string) {
  return callJson(tx`select app.admin_venue_detail(${venueId}::uuid) as result`);
}

export function mediaObject(tx: Tx, mediaId: string) {
  return callJson<{ storage_key: string; public: boolean }>(tx`select app.media_object(${mediaId}::uuid) as result`);
}

export function venuePhotos(tx: Tx, venueId: string) {
  return callJson<{ id: string; alt_text: string }[]>(tx`select app.venue_photos(${venueId}::uuid) as result`);
}
