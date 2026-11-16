// Typed wrappers over app.* domain functions and RLS-scoped reads. Call inside asAnon/asUser/asWorker.
import type postgres from "postgres";

type Tx = postgres.TransactionSql;

async function callJson<T>(query: postgres.PendingQuery<postgres.Row[]>): Promise<T> {
  const rows = await query;
  return rows[0]?.result as T;
}

// Customer booking foundation ---------------------------------------------------------------------------------
export type PriceSnapshot = {
  schema: "price.v1";
  currency: "INR";
  base_paise: number;
  service_fee_paise: number;
  tax_lines: unknown[];
  discount_paise: number;
  total_paise: number;
  hourly_paise: number;
  duration_minutes: number;
  rate_version: number;
  fee_config_version: string;
  synthetic: boolean;
};

export type QuoteResult = {
  quote_id: string;
  venue_id: string;
  resource_id: string;
  start_at: string;
  end_at: string;
  party_size: number;
  expires_at: string;
  price_snapshot: PriceSnapshot;
  policy_snapshot: Record<string, unknown>;
  policy_hash: string;
  venue_timezone: string;
};

export function createQuote(
  tx: Tx,
  input: { venue_id: string; resource_id: string; start_at: string; duration_minutes: number; party_size: number }
) {
  return callJson<QuoteResult>(tx`
    select app.create_quote(${input.venue_id}::uuid, ${input.resource_id}::uuid, ${input.start_at}::timestamptz,
                            ${input.duration_minutes}::integer, ${input.party_size}::integer) as result`);
}

export type HoldResult = {
  booking_id: string;
  public_ref: string;
  status: "HOLD";
  hold_expires_at: string;
  version: number;
  amount_paise: number;
  currency: "INR";
};

export function createBookingHold(
  tx: Tx,
  input: { quote_id: string; accepted_policy_hash: string; expected_quote_total_paise: number },
  requestId: string | null = null
) {
  return callJson<HoldResult>(tx`
    select app.create_booking_hold(${input.quote_id}::uuid, ${input.accepted_policy_hash},
                                   ${input.expected_quote_total_paise}::bigint, ${requestId}::uuid) as result`);
}

export function cancelHold(tx: Tx, bookingId: string, expectedVersion: number, requestId: string | null = null) {
  return callJson<{ booking_id: string; status: string; version: number }>(tx`
    select app.cancel_hold(${bookingId}::uuid, ${expectedVersion}::integer, ${requestId}::uuid) as result`);
}

export function createClosure(
  tx: Tx,
  input: { venue_id: string; resource_ids: string[] | null; start_at: string; end_at: string; reason: string },
  requestId: string | null = null
) {
  return callJson<{ closure_ids: string[]; resource_count: number; start_at: string; end_at: string }>(tx`
    select app.create_closure(${input.venue_id}::uuid, ${input.resource_ids}::uuid[], ${input.start_at}::timestamptz,
                              ${input.end_at}::timestamptz, ${input.reason}, ${requestId}::uuid) as result`);
}

// Account ----------------------------------------------------------------------------------------------------
export function acceptTerms(tx: Tx, termsVersion: string, privacyVersion: string) {
  return callJson<{ terms_version: string; terms_accepted_at: string; version: number }>(tx`
    select app.accept_terms(${termsVersion}, ${privacyVersion}) as result`);
}

export function requestPrivacy(tx: Tx, kind: "EXPORT" | "DELETE") {
  return callJson<{ request_id: string; kind: string; status: string; created: boolean }>(tx`
    select app.request_privacy(${kind}) as result`);
}

export function adminGrantVenueMembership(
  tx: Tx,
  input: { venue_id: string; profile_id: string; role: "STAFF" | "MANAGER" | "OWNER"; reason: string },
  requestId: string | null = null
) {
  return callJson<{ membership_id: string; role: string; status: string }>(tx`
    select app.admin_grant_venue_membership(${input.venue_id}::uuid, ${input.profile_id}::uuid, ${input.role},
                                            ${input.reason}, ${requestId}::uuid) as result`);
}

export function queueMetrics(tx: Tx) {
  return callJson<Record<string, unknown>>(tx`select app.queue_metrics() as result`);
}

export type MeRow = {
  profile_id: string;
  display_name: string | null;
  status: "ACTIVE" | "SUSPENDED" | "DELETION_PENDING" | "ANONYMIZED";
  terms_version: string | null;
  version: number;
  current_terms_version: string;
  current_privacy_version: string;
  venue_memberships: { venue_id: string; venue_name: string; venue_slug: string; role: "STAFF" | "MANAGER" | "OWNER" }[];
  platform_roles: ("SUPPORT" | "FINANCE" | "SUPERADMIN")[];
};

// Reads only the caller's own rows through RLS.
export async function getMe(tx: Tx): Promise<MeRow | undefined> {
  const rows = await tx`
    select p.id as profile_id, p.display_name, p.status, p.terms_version, p.version,
           app.current_terms_version() as current_terms_version,
           app.current_privacy_version() as current_privacy_version,
           app.my_memberships() as venue_memberships,
           coalesce((
             select jsonb_agg(pm.role order by pm.role) from public.platform_memberships pm
             where pm.user_id = p.id and pm.status = 'ACTIVE'
           ), '[]'::jsonb) as platform_roles
    from public.profiles p
    where p.auth_user_id = auth.uid()`;
  return rows[0] as MeRow | undefined;
}

// Public catalogue (anon role; RLS returns published venues only) ---------------------------------------------
export type PublishedVenueRow = {
  id: string;
  slug: string;
  name: string;
  category_code: string;
  locality: string;
  is_synthetic: boolean;
  byo_food: "ALLOWED" | "RESTRICTED" | "NOT_ALLOWED";
  byo_details: string;
  from_hourly_paise: number | null;
};

export async function listPublishedVenues(tx: Tx): Promise<PublishedVenueRow[]> {
  const rows = await tx`
    select v.id, v.slug, v.name, v.category_code, v.locality, v.is_synthetic, p.byo_food, p.byo_details,
           (select min(rr.hourly_paise)
              from public.resources r
              join public.resource_rates rr on rr.resource_id = r.id
             where r.venue_id = v.id and r.status = 'ACTIVE'
               and rr.effective_from <= now() and (rr.effective_to is null or now() < rr.effective_to)) as from_hourly_paise
    from public.venues v
    join public.venue_policies p on p.id = v.active_policy_id
    where v.status = 'PUBLISHED'
    order by v.name`;
  return rows as unknown as PublishedVenueRow[];
}

export async function getPublishedVenueBySlug(tx: Tx, slug: string) {
  const venues = await tx`
    select v.id, v.slug, v.name, v.category_code, v.locality, v.address, v.timezone, v.is_synthetic,
           p.byo_food, p.byo_details, p.outside_delivery, p.house_rules, p.content_hash as policy_hash,
           p.minimum_minutes, p.maximum_minutes, p.increment_minutes, p.buffer_minutes, p.policy_version
    from public.venues v
    join public.venue_policies p on p.id = v.active_policy_id
    where v.slug = ${slug} and v.status = 'PUBLISHED'`;
  const venue = venues[0];
  if (!venue) return undefined;
  const resources = await tx`
    select r.id, r.label, r.capacity, rr.hourly_paise
    from public.resources r
    join public.resource_rates rr on rr.resource_id = r.id
      and rr.effective_from <= now() and (rr.effective_to is null or now() < rr.effective_to)
    where r.venue_id = ${venue.id as string}::uuid and r.status = 'ACTIVE'
    order by r.label`;
  const hours = await tx`
    select weekday, to_char(opens_local, 'HH24:MI') as opens, to_char(closes_local, 'HH24:MI') as closes, closes_next_day
    from public.opening_periods
    where venue_id = ${venue.id as string}::uuid
      and schedule_version = (select active_schedule_version from public.venues where id = ${venue.id as string}::uuid)
    order by weekday, opens_local`;
  return { venue, resources, hours };
}

// Partner operations (authenticated; RLS limits rows to assigned venues) ---------------------------------------
export async function isVenueMember(tx: Tx, venueId: string, roles?: ("STAFF" | "MANAGER" | "OWNER")[]) {
  const rows = roles
    ? await tx`select app.is_venue_member(${venueId}::uuid, ${roles}::text[]) as ok`
    : await tx`select app.is_venue_member(${venueId}::uuid) as ok`;
  return rows[0]?.ok === true;
}

// Minimal calendar (no customer identity or money) for assigned, MFA-verified staff and managers.
export async function listVenueBookings(tx: Tx, venueId: string, days = 30) {
  const rows = await tx`
    select app.venue_bookings_calendar(${venueId}::uuid, now() - interval '1 day', now() + make_interval(days => ${days}::integer)) as result`;
  return (rows[0]?.result ?? []) as Record<string, unknown>[];
}

// Idempotency (same transaction as the domain write) ----------------------------------------------------------
export type IdempotencyBegin = { state: "NEW" } | { state: "REPLAY"; http_status: number; response: unknown };

export function idempotencyBegin(tx: Tx, route: string, key: string, requestHash: string) {
  return callJson<IdempotencyBegin>(tx`select app.idempotency_begin(${route}, ${key}::uuid, ${requestHash}) as result`);
}

export async function idempotencyComplete(tx: Tx, route: string, key: string, httpStatus: number, response: unknown) {
  await tx`select app.idempotency_complete(${route}, ${key}::uuid, ${httpStatus}::integer, ${tx.json(response as postgres.JSONValue)})`;
}

// Worker ------------------------------------------------------------------------------------------------------
export type OutboxJob = {
  id: string;
  business_key: string;
  kind:
    | "booking.hold_expired"
    | "booking.confirmed"
    | "booking.cancelled"
    | "booking.no_show"
    | "invitation.created"
    | "extension.notify"
    | "notification.email"
    | "privacy.delete_requested"
    | "diagnostic.sleep"
    | "payment.provider_event"
    | "refund.submit"
    | "refund.requested";
  safe_payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

export async function expireDueHolds(tx: Tx, limit = 100): Promise<number> {
  const rows = await tx`select app.expire_due_holds(${limit}::integer) as count`;
  return Number(rows[0]?.count ?? 0);
}

export async function leaseJobs(
  tx: Tx,
  workerId: string,
  limit: number,
  leaseSeconds: number,
  kinds: OutboxJob["kind"][] | null = null
): Promise<OutboxJob[]> {
  const rows = await tx`
    select id, business_key, kind, safe_payload, attempts, max_attempts
    from app.lease_jobs(${workerId}, ${limit}::integer, ${leaseSeconds}::integer, ${kinds}::text[])`;
  return rows as unknown as OutboxJob[];
}

export async function completeJob(tx: Tx, jobId: string, workerId: string): Promise<boolean> {
  const rows = await tx`select app.complete_job(${jobId}::uuid, ${workerId}) as ok`;
  return rows[0]?.ok === true;
}

export async function failJob(tx: Tx, jobId: string, workerId: string, errorCode: string, retryable = true): Promise<string> {
  const rows = await tx`select app.fail_job(${jobId}::uuid, ${workerId}, ${errorCode}, ${retryable}) as status`;
  return String(rows[0]?.status);
}

export async function recordHeartbeat(
  tx: Tx,
  h: { workerId: string; startedAt: Date; ticks: number; completed: number; failed: number; expired: number; lastError?: string }
) {
  await tx`select app.record_heartbeat(${h.workerId}, ${h.startedAt}::timestamptz, ${h.ticks}::bigint, ${h.completed}::bigint,
                                       ${h.failed}::bigint, ${h.expired}::bigint, ${h.lastError ?? null})`;
}

// Removes expired idempotency responses and long-expired, never-booked quotes (worker; small batches).
export async function purgeOperationalData(tx: Tx, limit = 500): Promise<{ idempotency_records: number; quotes: number }> {
  const rows = await tx`select app.purge_operational_data(${limit}::integer) as result`;
  return rows[0]?.result as { idempotency_records: number; quotes: number };
}

export async function jobBookingHoldExpired(tx: Tx, bookingId: string): Promise<number> {
  const rows = await tx`select app.job_booking_hold_expired(${bookingId}::uuid) as queued`;
  return Number(rows[0]?.queued ?? 0);
}

export type NotificationDelivery = {
  notification_id: string;
  status: "QUEUED" | "SENT" | "FAILED";
  template: string;
  channel: "IN_APP" | "EMAIL";
  booking_public_ref: string | null;
  to_email: string | null;
};

export function notificationDelivery(tx: Tx, notificationId: string) {
  return callJson<NotificationDelivery | null>(tx`select app.notification_delivery(${notificationId}::uuid) as result`);
}

export async function markNotification(tx: Tx, notificationId: string, status: "SENT" | "FAILED", providerRef: string | null) {
  const rows = await tx`select app.mark_notification(${notificationId}::uuid, ${status}, ${providerRef}) as ok`;
  return rows[0]?.ok === true;
}

export async function jobPrivacyDeleteRequested(tx: Tx, requestId: string): Promise<string | null> {
  const rows = await tx`select app.job_privacy_delete_requested(${requestId}::uuid) as status`;
  return (rows[0]?.status as string | null) ?? null;
}

export async function applyDiagnosticEffect(tx: Tx, businessKey: string, workerId: string): Promise<boolean> {
  const rows = await tx`select app.apply_diagnostic_effect(${businessKey}, ${workerId}) as applied`;
  return rows[0]?.applied === true;
}

// Discovery (anon or authenticated; published venues only) -----------------------------------------------------
export type VenueSearchInput = {
  lat: number | null;
  lng: number | null;
  radius_m: number | null;
  start_at: string | null;
  duration_minutes: number | null;
  party_size: number | null;
  categories: string[] | null;
  requirements: string[] | null;
  environment: string[] | null;
  amenities: string[] | null;
  available_only: boolean;
  offset: number;
  limit: number;
};

export type VenueSearchRows = { venues: Record<string, unknown>[]; total: number; next_offset: number | null; searched_at: string };

export function searchVenues(tx: Tx, q: VenueSearchInput) {
  return callJson<VenueSearchRows>(tx`
    select app.search_venues(${q.lat}::double precision, ${q.lng}::double precision, ${q.radius_m}::integer,
                             ${q.start_at}::timestamptz, ${q.duration_minutes}::integer, ${q.party_size}::integer,
                             ${q.categories}::text[], ${q.requirements}::text[], ${q.environment}::text[], ${q.amenities}::text[],
                             ${q.available_only}::boolean, ${q.offset}::integer, ${q.limit}::integer) as result`);
}

export function venueDetail(tx: Tx, venueId: string) {
  return callJson<Record<string, unknown> | null>(tx`select app.venue_detail(${venueId}::uuid) as result`);
}

// Slug -> id through RLS (published venues for anon).
export async function venueIdBySlug(tx: Tx, slug: string): Promise<string | null> {
  const rows = await tx`select id from public.venues where slug = ${slug} and status = 'PUBLISHED'`;
  return (rows[0]?.id as string | undefined) ?? null;
}

export function venueDayAvailability(tx: Tx, venueId: string, date: string, durationMinutes: number, partySize: number) {
  return callJson<Record<string, unknown>>(tx`
    select app.venue_day_availability(${venueId}::uuid, ${date}::date, ${durationMinutes}::integer, ${partySize}::integer) as result`);
}

// Customer bookings and checkout (authenticated) --------------------------------------------------------------
export type CustomerBookingRow = Record<string, unknown> & {
  booking_id: string;
  status: string;
  venue: Record<string, unknown>;
};

export function customerBooking(tx: Tx, bookingId: string) {
  return callJson<CustomerBookingRow>(tx`select app.customer_booking(${bookingId}::uuid) as result`);
}

export function customerBookings(tx: Tx, scope: "upcoming" | "past" | "all", offset: number, limit: number) {
  return callJson<{ bookings: CustomerBookingRow[]; total: number; next_offset: number | null }>(tx`
    select app.customer_bookings(${scope}, ${offset}::integer, ${limit}::integer) as result`);
}

export type PaymentOrderRow = {
  payment_order_id: string;
  booking_id: string;
  // Set for an extension's incremental payment (M4.2); null for the booking's own payment.
  extension_id?: string | null;
  state: "CREATED" | "ORDER_PENDING" | "READY" | "UNKNOWN" | "EXPIRED";
  provider: "mock";
  environment: "TEST" | "LIVE";
  provider_order_id: string | null;
  operation_key: string;
  expected_amount_paise: number;
  currency: "INR";
  expires_at: string;
  version: number;
};

export function customerPaymentOrder(tx: Tx, orderId: string) {
  return callJson<PaymentOrderRow & { booking: CustomerBookingRow }>(tx`select app.customer_payment_order(${orderId}::uuid) as result`);
}

export function beginCheckout(
  tx: Tx,
  input: { booking_id: string; expected_version: number; provider: "mock"; environment: "TEST" | "LIVE" },
  requestId: string | null = null
) {
  return callJson<PaymentOrderRow & { created: boolean; booking_status: string; booking_version: number; hold_expires_at: string }>(tx`
    select app.begin_checkout(${input.booking_id}::uuid, ${input.expected_version}::integer, ${input.provider},
                              ${input.environment}, ${requestId}::uuid) as result`);
}

// Payment truth (worker role only) ------------------------------------------------------------------------------
export function claimOrderCreation(tx: Tx, orderId: string, leaseSeconds = 30) {
  return callJson<PaymentOrderRow & { claimed: boolean }>(tx`
    select app.claim_order_creation(${orderId}::uuid, ${leaseSeconds}::integer) as result`);
}

export function recordProviderOrder(tx: Tx, orderId: string, providerOrderId: string) {
  return callJson<PaymentOrderRow>(tx`select app.record_provider_order(${orderId}::uuid, ${providerOrderId}) as result`);
}

export function recordOrderCreationUnknown(tx: Tx, orderId: string, errorCode: string) {
  return callJson<PaymentOrderRow>(tx`select app.record_order_creation_unknown(${orderId}::uuid, ${errorCode}) as result`);
}

export type PaymentObservation = {
  order_id: string;
  provider: "mock";
  environment: "TEST" | "LIVE";
  provider_order_id: string;
  provider_payment_id: string;
  amount_paise: number;
  currency: string;
  state: "PENDING" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "UNKNOWN";
  captured_at: string | null;
  source: "VERIFY" | "WEBHOOK" | "RECONCILE";
  provider_event_row_id: string | null;
  token_hash: string;
  pin_hash: string;
};

export type ObservationOutcome = {
  outcome: "RECORDED" | "CONFIRMED" | "REFUND_DUE" | "QUARANTINED" | "MISMATCHED_ORDER";
  booking_id: string;
  booking_status: string;
  attempt_id?: string;
  attempt_state?: string;
  allocation_state?: string;
};

export function processPaymentObservation(tx: Tx, o: PaymentObservation) {
  return callJson<ObservationOutcome>(tx`
    select app.process_payment_observation(${o.order_id}::uuid, ${o.provider}, ${o.environment}, ${o.provider_order_id},
      ${o.provider_payment_id}, ${o.amount_paise}::bigint, ${o.currency}, ${o.state}, ${o.captured_at}::timestamptz,
      ${o.source}, ${o.provider_event_row_id}::uuid, ${o.token_hash}, ${o.pin_hash}) as result`);
}

export function findPaymentOrder(tx: Tx, provider: string, environment: string, providerOrderId: string) {
  return callJson<PaymentOrderRow | null>(tx`
    select app.find_payment_order(${provider}, ${environment}, ${providerOrderId}) as result`);
}

export function getPaymentOrder(tx: Tx, orderId: string) {
  return callJson<PaymentOrderRow | null>(tx`select app.get_payment_order(${orderId}::uuid) as result`);
}

export function ingestProviderEvent(
  tx: Tx,
  e: { provider: string; environment: string; event_id: string; event_type: string; safe_payload: Record<string, unknown>; payload_hash: string }
) {
  return callJson<{ event_row_id: string; duplicate: boolean }>(tx`
    select app.ingest_provider_event(${e.provider}, ${e.environment}, ${e.event_id}, ${e.event_type},
                                     ${tx.json(e.safe_payload as postgres.JSONValue)}, ${e.payload_hash}) as result`);
}

export type ProviderEventRow = {
  id: string;
  provider: string;
  environment: string;
  event_id: string;
  event_type: string;
  safe_payload: Record<string, unknown>;
  status: "RECEIVED" | "PROCESSED" | "RETRY" | "QUARANTINED";
};

export function getProviderEvent(tx: Tx, eventRowId: string) {
  return callJson<ProviderEventRow | null>(tx`select app.get_provider_event(${eventRowId}::uuid) as result`);
}

export async function markProviderEvent(
  tx: Tx,
  eventRowId: string,
  status: "PROCESSED" | "RETRY" | "QUARANTINED",
  errorCode: string | null = null
) {
  await tx`select app.mark_provider_event(${eventRowId}::uuid, ${status}, ${errorCode})`;
}

export async function ordersToReconcile(tx: Tx, limit = 20): Promise<(PaymentOrderRow & { booking_status: string })[]> {
  const rows = await tx`select app.orders_to_reconcile(${limit}::integer) as result`;
  return rows.map((r) => r.result as PaymentOrderRow & { booking_status: string });
}

export async function markOrderReconciled(tx: Tx, orderId: string) {
  await tx`select app.mark_order_reconciled(${orderId}::uuid)`;
}

export type RefundSubmission = {
  refund_id: string;
  status: "REQUESTED" | "PROCESSING" | "PROCESSED" | "FAILED" | "UNKNOWN";
  amount_paise: number;
  currency: "INR";
  operation_key: string;
  provider: string;
  environment: string;
  provider_payment_id: string;
  provider_refund_id: string | null;
};

export function refundForSubmission(tx: Tx, refundId: string) {
  return callJson<RefundSubmission | null>(tx`select app.refund_for_submission(${refundId}::uuid) as result`);
}

// Refunds whose submission stalled; the call claims them (reconciled_at) so parallel workers do not repeat each other.
export async function refundsToReconcile(tx: Tx, limit = 20): Promise<string[]> {
  const rows = await tx`select app.refunds_to_reconcile(${limit}::integer) as id`;
  return rows.map((r) => r.id as string);
}

export function recordRefundResult(
  tx: Tx,
  refundId: string,
  status: "PROCESSING" | "PROCESSED" | "FAILED" | "UNKNOWN",
  providerRefundId: string | null,
  errorCode: string | null = null
) {
  return callJson<{ refund_id: string; status: string; changed: boolean }>(tx`
    select app.record_refund_result(${refundId}::uuid, ${status}, ${providerRefundId}, ${errorCode}) as result`);
}

export async function jobNotifyBooking(tx: Tx, bookingId: string, eventKey: string, template: string): Promise<number> {
  const rows = await tx`select app.job_notify_booking(${bookingId}::uuid, ${eventKey}, ${template}) as queued`;
  return Number(rows[0]?.queued ?? 0);
}

// Staff arrival (authenticated staff, aal2) ---------------------------------------------------------------------
export function staffArrivals(tx: Tx, venueId: string, date: string) {
  return callJson<Record<string, unknown>>(tx`select app.staff_arrivals(${venueId}::uuid, ${date}::date) as result`);
}

export type CheckInOutcome =
  | { outcome: "INVALID" }
  | ({ outcome: "CHECKED_IN" | "ALREADY_CHECKED_IN" } & Record<string, unknown>);

export function staffCheckIn(
  tx: Tx,
  input: { venue_id: string; qr_token: string | null; public_ref: string | null; pin: string | null },
  requestId: string | null = null
) {
  return callJson<CheckInOutcome>(tx`
    select app.staff_check_in(${input.venue_id}::uuid, ${input.qr_token}, ${input.public_ref}, ${input.pin},
                              ${requestId}::uuid) as result`);
}

export function staffCheckOut(tx: Tx, bookingId: string, expectedVersion: number, requestId: string | null = null) {
  return callJson<Record<string, unknown>>(tx`
    select app.staff_check_out(${bookingId}::uuid, ${expectedVersion}::integer, ${requestId}::uuid) as result`);
}

export function staffMarkReady(tx: Tx, resourceId: string, expectedVersion: number, requestId: string | null = null) {
  return callJson<Record<string, unknown>>(tx`
    select app.staff_mark_ready(${resourceId}::uuid, ${expectedVersion}::integer, ${requestId}::uuid) as result`);
}

// Cancellation (M4.1) -------------------------------------------------------------------------------------------
export function cancelPreview(tx: Tx, bookingId: string) {
  return callJson<Record<string, unknown>>(tx`select app.cancel_preview(${bookingId}::uuid) as result`);
}

export function cancelBooking(
  tx: Tx,
  input: { booking_id: string; reason_code: string | null; expected_version: number; expected_refund_paise: number },
  requestId: string | null = null
) {
  return callJson<Record<string, unknown>>(tx`
    select app.cancel_booking(${input.booking_id}::uuid, ${input.reason_code}, ${input.expected_version}::integer,
                              ${input.expected_refund_paise}::bigint, ${requestId}::uuid) as result`);
}

export function serviceCancelBooking(
  tx: Tx,
  input: { booking_id: string; reason_code: string; reason: string; expected_version: number },
  requestId: string | null = null
) {
  return callJson<Record<string, unknown>>(tx`
    select app.service_cancel_booking(${input.booking_id}::uuid, ${input.reason_code}, ${input.reason},
                                      ${input.expected_version}::integer, ${requestId}::uuid) as result`);
}
