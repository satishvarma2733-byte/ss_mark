// Shared request/response contracts. Client-safe: no server secrets or domain services here.
import { z } from "zod";

// All money is integer paise (INR x 100). Never use floats for amounts.
export const paiseSchema = z.number().int().nonnegative();

export const moneySchema = z.object({
  amountPaise: paiseSchema,
  currency: z.literal("INR")
});
export type Money = z.infer<typeof moneySchema>;

export const venueCategorySchema = z.enum(["cafe", "restaurant", "hotel", "brewery", "lounge", "workspace"]);
export type VenueCategory = z.infer<typeof venueCategorySchema>;

export const foodPolicySchema = z.object({
  mode: z.enum(["allowed", "restricted", "prohibited"]),
  note: z.string().min(1).max(280)
});
export type FoodPolicy = z.infer<typeof foodPolicySchema>;

// Every synthetic record carries isSynthetic: true so UI and tests can label it.
export const venueSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  category: venueCategorySchema,
  locality: z.string().min(1).max(120),
  tableFromPrice: moneySchema,
  pricingBasis: z.literal("per 30 minutes, one table"),
  foodPolicy: foodPolicySchema,
  isSynthetic: z.literal(true)
});
export type VenueSummary = z.infer<typeof venueSummarySchema>;

export const venueListSchema = z.object({
  venues: z.array(venueSummarySchema),
  mode: z.literal("mock")
});
export type VenueList = z.infer<typeof venueListSchema>;

// Error envelope from docs/07 s.1 (snake_case, request_id at top level).
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
    field_errors: z.record(z.string(), z.string()).default({}),
    details: z.record(z.string(), z.unknown()).optional()
  }),
  request_id: z.string().min(1)
});
export type ApiErrorEnvelope = z.infer<typeof apiErrorSchema>;

// Stable domain codes with HTTP status and safe customer-facing text (docs/07 s.1).
export const DOMAIN_ERRORS = {
  MALFORMED_REQUEST: { status: 400, retryable: false, message: "The request could not be read." },
  INVALID_CURSOR: { status: 400, retryable: false, message: "That page link is no longer valid." },
  AUTH_REQUIRED: { status: 401, retryable: false, message: "Please sign in to continue." },
  SESSION_EXPIRED: { status: 401, retryable: false, message: "Your session ended. Please sign in again." },
  FORBIDDEN: { status: 403, retryable: false, message: "You do not have permission to do that." },
  ACCOUNT_SUSPENDED: { status: 403, retryable: false, message: "This account is suspended. Contact support." },
  ACCOUNT_DELETION_PENDING: {
    status: 403,
    retryable: false,
    message: "Your account has a pending deletion request, so new bookings are paused."
  },
  REAUTH_REQUIRED: { status: 403, retryable: false, message: "Please verify again to continue." },
  NOT_FOUND: { status: 404, retryable: false, message: "We could not find that." },
  SLOT_UNAVAILABLE: { status: 409, retryable: false, message: "This table is no longer available. Choose another time." },
  STALE_VERSION: { status: 409, retryable: false, message: "This changed since you opened it. Refresh and try again." },
  QUOTE_CHANGED: { status: 409, retryable: false, message: "The price or rules changed. Review the new quote." },
  INVALID_TRANSITION: { status: 409, retryable: false, message: "That action is no longer possible." },
  RECONCILIATION_REQUIRED: {
    status: 409,
    retryable: false,
    message: "Run a reconciliation that matches the provider for this payout period first."
  },
  SEPARATION_OF_DUTIES: { status: 403, retryable: false, message: "A different finance person must approve this." },
  CANCELLATION_CHANGED: { status: 409, retryable: false, message: "The refund for cancelling has changed. Review it again." },
  IDEMPOTENCY_CONFLICT: { status: 409, retryable: false, message: "This request conflicts with an earlier one." },
  OPERATION_IN_PROGRESS: { status: 409, retryable: true, message: "This is still being processed. Try again shortly." },
  HOLD_EXPIRED: { status: 410, retryable: false, message: "Your hold expired. Choose a time again." },
  QUOTE_EXPIRED: { status: 410, retryable: false, message: "This quote expired. Get a fresh quote." },
  EXTENSION_EXPIRED: { status: 410, retryable: false, message: "This extension offer expired." },
  INVITATION_EXPIRED: { status: 410, retryable: false, message: "This invitation has expired. Ask your venue manager to send a new one." },
  VALIDATION_FAILED: { status: 422, retryable: false, message: "Some details need attention." },
  PARTY_TOO_LARGE: { status: 422, retryable: false, message: "This table is too small for your party." },
  OUTSIDE_HOURS: { status: 422, retryable: false, message: "That time is outside the venue's bookable hours." },
  POLICY_NOT_ACCEPTED: { status: 422, retryable: false, message: "Please review and accept the current rules." },
  POLICY_NOT_CONFIGURED: { status: 422, retryable: false, message: "This venue is not taking bookings yet." },
  PAYMENT_AMOUNT_MISMATCH: { status: 422, retryable: false, message: "The payment amount did not match." },
  CHECK_IN_NOT_OPEN: { status: 409, retryable: false, message: "Check-in is not open for this booking right now." },
  TABLE_NOT_READY: { status: 409, retryable: false, message: "The table is not marked ready yet." },
  ARRIVAL_CODE_INVALID: { status: 422, retryable: false, message: "That code did not match a booking for this venue." },
  RATE_LIMITED: { status: 429, retryable: true, message: "Too many attempts. Wait a moment and try again." },
  UPDATE_REQUIRED: {
    status: 426,
    retryable: false,
    message: "Please update the app to make new bookings. Your bookings, receipts and support stay available."
  },
  PAYOUTS_PAUSED: { status: 409, retryable: false, message: "Payout release is paused. It must be reopened before payouts move." },
  BOOKINGS_PAUSED: {
    status: 503,
    retryable: false,
    message: "New bookings are paused for now. Your existing bookings are not affected."
  },
  EXTENSIONS_PAUSED: {
    status: 503,
    retryable: false,
    message: "Extensions are paused for now. Your booking and its end time are not affected."
  },
  PROVIDER_UNAVAILABLE: { status: 503, retryable: true, message: "A service we rely on is unavailable. Try again shortly." },
  DEPENDENCY_UNAVAILABLE: { status: 503, retryable: true, message: "We are having trouble right now. Try again shortly." },
  INTERNAL_ERROR: { status: 500, retryable: false, message: "Something went wrong on our side." }
} as const satisfies Record<string, { status: number; retryable: boolean; message: string }>;
export type DomainErrorCode = keyof typeof DOMAIN_ERRORS;

export function isDomainErrorCode(value: unknown): value is DomainErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DOMAIN_ERRORS, value);
}

// Account and session (docs/07 s.2) ---------------------------------------------------------------------------
export const otpRequestSchema = z.strictObject({
  email: z.email().max(254),
  intent: z.enum(["sign_in"]).default("sign_in"),
  redirect_path: z.string().max(300).optional()
});
export const otpVerifySchema = z.strictObject({
  email: z.email().max(254),
  code: z.string().regex(/^\d{6}$/),
  accept_terms: z.boolean().optional()
});
export const acceptTermsSchema = z.strictObject({
  terms_version: z.string().min(1).max(60),
  privacy_version: z.string().min(1).max(60)
});
export const privacyRequestSchema = z.strictObject({ kind: z.enum(["EXPORT", "DELETE"]) });

export const meSchema = z.object({
  profile_id: z.uuid(),
  display_name: z.string().nullable(),
  status: z.enum(["ACTIVE", "SUSPENDED", "DELETION_PENDING", "ANONYMIZED"]),
  terms_required: z.boolean(),
  current_terms_version: z.string(),
  current_privacy_version: z.string(),
  aal: z.enum(["aal1", "aal2"]),
  mfa_required_for_portal: z.boolean(),
  venue_memberships: z.array(
    z.object({ venue_id: z.uuid(), venue_name: z.string(), venue_slug: z.string(), role: z.enum(["STAFF", "MANAGER", "OWNER"]) })
  ),
  platform_roles: z.array(z.enum(["SUPPORT", "FINANCE", "SUPERADMIN"])),
  version: z.number().int()
});
export type Me = z.infer<typeof meSchema>;

// Booking foundation (docs/07 s.3) ----------------------------------------------------------------------------
export const quoteRequestSchema = z.strictObject({
  venue_id: z.uuid(),
  resource_id: z.uuid(),
  start_at: z.iso.datetime({ offset: true }),
  duration_minutes: z.number().int().min(1).max(1440),
  party_size: z.number().int().min(1).max(50)
});
export const holdRequestSchema = z.strictObject({
  quote_id: z.uuid(),
  accepted_policy_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  expected_quote_total_paise: paiseSchema
});
export const closureRequestSchema = z.strictObject({
  start_at: z.iso.datetime({ offset: true }),
  end_at: z.iso.datetime({ offset: true }),
  reason: z.string().min(3).max(500)
});

// Discovery (docs/07 s.2) -------------------------------------------------------------------------------------
export const CATEGORY_CODES = ["CAFE", "HOTEL", "RESTAURANT", "LOUNGE", "BREWERY", "WORKSPACE"] as const;
export const REQUIREMENT_TAGS = ["WORK", "MEET", "WAIT", "STUDY", "GATHER", "RELAX"] as const;
export const ENVIRONMENT_TAGS = ["QUIET", "LIVELY", "OUTDOOR", "SEMI_PRIVATE"] as const;
export const AMENITY_CODES = [
  "WIFI", "POWER_OUTLETS", "AIR_CONDITIONING", "RESTROOM", "ACCESSIBLE_ENTRANCE", "ACCESSIBLE_RESTROOM", "PARKING",
  "OUTDOOR_SEATING", "QUIET_ZONE"
] as const;
export const foodRuleSchema = z.enum(["ALLOWED", "RESTRICTED", "NOT_ALLOWED"]);
export type FoodRule = z.infer<typeof foodRuleSchema>;

// Bounded pilot service area for manual search (docs/09 Bengaluru cluster). Area centres, not anyone's location.
export const PILOT_AREAS = [
  { code: "koramangala", label: "Koramangala", lat: 12.9352, lng: 77.6245 },
  { code: "indiranagar", label: "Indiranagar", lat: 12.9784, lng: 77.6408 },
  { code: "hsr-layout", label: "HSR Layout", lat: 12.9116, lng: 77.6387 },
  { code: "btm-layout", label: "BTM Layout", lat: 12.9166, lng: 77.6101 },
  { code: "mg-road", label: "MG Road", lat: 12.975, lng: 77.607 },
  { code: "jayanagar", label: "Jayanagar", lat: 12.925, lng: 77.5838 }
] as const;
export type PilotArea = (typeof PILOT_AREAS)[number];
export const PILOT_AREA_CODES = PILOT_AREAS.map((a) => a.code) as [PilotArea["code"], ...PilotArea["code"][]];

// Device location is rounded to about 1 km before it leaves the client; the server rounds again and never logs it.
export function coarseCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

const csvOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .max(200)
    .transform((value) => value.split(",").map((part) => part.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).max(values.length));

// GET /venues query string. Unknown filter values are rejected, never ignored (docs/07 s.2).
export const venueSearchQuerySchema = z.strictObject({
  area: z.enum(PILOT_AREA_CODES).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radius_m: z.coerce.number().int().min(500).max(25000).optional(),
  start_at: z.iso.datetime({ offset: true }).optional(),
  duration_minutes: z.coerce.number().int().min(15).max(1440).optional(),
  party_size: z.coerce.number().int().min(1).max(50).optional(),
  requirement: z.enum(REQUIREMENT_TAGS).optional(),
  category: csvOf(CATEGORY_CODES).optional(),
  environment_tags: csvOf(ENVIRONMENT_TAGS).optional(),
  amenities: csvOf(AMENITY_CODES).optional(),
  available_only: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  cursor: z.string().max(40).optional()
});
export type VenueSearchQuery = z.infer<typeof venueSearchQuerySchema>;

export const venueAvailabilitySummarySchema = z.object({
  available_tables: z.number().int(),
  checked_tables: z.number().int(),
  problems: z.array(z.string())
});

export const venueSearchItemSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  category_code: z.enum(CATEGORY_CODES),
  locality: z.string(),
  is_synthetic: z.boolean(),
  lat: z.number(),
  lng: z.number(),
  distance_m: z.number().int().nullable(),
  from_hourly_paise: z.number().int().nullable(),
  byo_food: foodRuleSchema,
  byo_details: z.string(),
  outside_delivery: foodRuleSchema,
  max_capacity: z.number().int().nullable(),
  requirements: z.array(z.string()),
  environment: z.array(z.string()),
  amenities: z.array(z.string()),
  availability: venueAvailabilitySummarySchema.nullable()
});
export type VenueSearchItem = z.infer<typeof venueSearchItemSchema>;

export const venueSearchResultSchema = z.object({
  venues: z.array(venueSearchItemSchema),
  total: z.number().int(),
  next_cursor: z.string().nullable(),
  searched_at: z.string(),
  area: z.object({ label: z.string(), lat: z.number(), lng: z.number(), source: z.enum(["area", "device"]) }).nullable()
});
export type VenueSearchResult = z.infer<typeof venueSearchResultSchema>;

export const venuePolicySummarySchema = z.object({
  policy_id: z.uuid(),
  policy_version: z.number().int(),
  policy_hash: z.string(),
  byo_food: foodRuleSchema,
  byo_details: z.string(),
  outside_delivery: foodRuleSchema,
  handover_instructions: z.string(),
  house_rules: z.string(),
  cancel_cutoff_minutes: z.number().int(),
  early_refund_bps: z.number().int(),
  late_refund_bps: z.number().int(),
  minimum_minutes: z.number().int(),
  increment_minutes: z.number().int(),
  maximum_minutes: z.number().int(),
  buffer_minutes: z.number().int(),
  grace_minutes: z.number().int(),
  lead_minutes: z.number().int(),
  max_horizon_days: z.number().int(),
  hold_minutes: z.number().int()
});
export type VenuePolicySummary = z.infer<typeof venuePolicySummarySchema>;

// Published reviews of a venue (M4.5).
export const venueReviewsSchema = z.object({
  count: z.number().int(), average: z.number().nullable(),
  recent: z.array(z.object({ rating: z.number().int(), body: z.string().nullable(), month: z.string() }))
});
export type VenueReviews = z.infer<typeof venueReviewsSchema>;
export const venueDetailSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  category_code: z.enum(CATEGORY_CODES),
  description: z.string(),
  address: z.string(),
  locality: z.string(),
  timezone: z.string(),
  is_synthetic: z.boolean(),
  lat: z.number(),
  lng: z.number(),
  policy: venuePolicySummarySchema,
  tables: z.array(z.object({ resource_id: z.uuid(), label: z.string(), capacity: z.number().int(), hourly_paise: z.number().int().nullable() })),
  hours: z.array(z.object({ weekday: z.number().int(), opens: z.string(), closes: z.string(), closes_next_day: z.boolean() })),
  amenities: z.array(z.object({ code: z.string(), verified: z.boolean() })),
  requirements: z.array(z.string()),
  environment: z.array(z.string()),
  // Approved photos only; images are served by GET /api/v1/media/{id}.
  photos: z.array(z.object({ id: z.uuid(), alt_text: z.string() })).default([]),
  // Published reviews only (M4.5).
  reviews: venueReviewsSchema.default({ count: 0, average: null, recent: [] })
});
export type VenueDetail = z.infer<typeof venueDetailSchema>;

export const availabilityQuerySchema = z.strictObject({
  date: z.iso.date(),
  duration_minutes: z.coerce.number().int().min(15).max(1440),
  party_size: z.coerce.number().int().min(1).max(50)
});

export const priceSnapshotSchema = z.object({
  schema: z.literal("price.v1"),
  currency: z.literal("INR"),
  base_paise: z.number().int(),
  service_fee_paise: z.number().int(),
  tax_lines: z.array(z.unknown()),
  discount_paise: z.number().int(),
  total_paise: z.number().int(),
  hourly_paise: z.number().int(),
  duration_minutes: z.number().int(),
  rate_version: z.number().int(),
  fee_config_version: z.string(),
  synthetic: z.boolean()
});
export type PriceSnapshot = z.infer<typeof priceSnapshotSchema>;

export const venueAvailabilitySchema = z.object({
  venue_id: z.uuid(),
  date: z.string(),
  timezone: z.string(),
  duration_minutes: z.number().int(),
  party_size: z.number().int(),
  increment_minutes: z.number().int(),
  tables: z.array(z.object({
    resource_id: z.uuid(),
    label: z.string(),
    capacity: z.number().int(),
    price: z.union([priceSnapshotSchema, z.object({ error: z.string() })]),
    starts: z.array(z.string())
  })),
  reason: z.string().nullable(),
  checked_at: z.string()
});
export type VenueAvailability = z.infer<typeof venueAvailabilitySchema>;

// Quote and hold responses -------------------------------------------------------------------------------------
export const policySnapshotSchema = z.looseObject({
  schema: z.literal("policy.v1"),
  byo_food: foodRuleSchema,
  byo_details: z.string(),
  outside_delivery: foodRuleSchema,
  handover_instructions: z.string(),
  house_rules: z.string(),
  cancel_cutoff_minutes: z.number().int(),
  early_refund_bps: z.number().int(),
  late_refund_bps: z.number().int(),
  buffer_minutes: z.number().int(),
  grace_minutes: z.number().int(),
  hold_minutes: z.number().int(),
  policy_version: z.number().int()
});
export type PolicySnapshot = z.infer<typeof policySnapshotSchema>;

export const quoteSchema = z.object({
  quote_id: z.uuid(),
  venue_id: z.uuid(),
  resource_id: z.uuid(),
  start_at: z.string(),
  end_at: z.string(),
  party_size: z.number().int(),
  expires_at: z.string(),
  price_snapshot: priceSnapshotSchema,
  policy_snapshot: policySnapshotSchema,
  policy_hash: z.string(),
  venue_timezone: z.string()
});
export type Quote = z.infer<typeof quoteSchema>;

export const holdSchema = z.object({
  booking_id: z.uuid(),
  public_ref: z.string(),
  status: z.literal("HOLD"),
  hold_expires_at: z.string(),
  version: z.number().int(),
  amount_paise: z.number().int(),
  currency: z.literal("INR")
});
export type Hold = z.infer<typeof holdSchema>;

// Booking projection (docs/07 s.2 GET /bookings/{id}): booking, payment, allocation and refund states stay separate.
export const BOOKING_STATUSES = [
  "HOLD", "PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "EXPIRED", "NO_SHOW"
] as const;
export const bookingStatusSchema = z.enum(BOOKING_STATUSES);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

export const bookingPaymentSchema = z.object({
  payment_order_id: z.uuid(),
  order_state: z.enum(["CREATED", "ORDER_PENDING", "READY", "UNKNOWN", "EXPIRED"]),
  provider: z.string(),
  environment: z.enum(["TEST", "LIVE"]),
  payment_state: z.enum(["NONE", "PENDING", "AUTHORIZED", "CAPTURED", "FAILED", "UNKNOWN"]),
  allocation: z.enum(["ALLOCATED", "UNDER_REVIEW", "REFUND_DUE", "REFUNDED"]).nullable(),
  failed_attempts: z.number().int(),
  // Attempts still PENDING/AUTHORIZED/UNKNOWN at the provider (may yet be captured).
  open_attempts: z.number().int().default(0)
});

export const bookingRefundSchema = z.object({
  refund_id: z.uuid(),
  status: z.enum(["REQUESTED", "PROCESSING", "PROCESSED", "FAILED", "UNKNOWN"]),
  amount_paise: z.number().int(),
  reason_code: z.string(),
  created_at: z.string()
});

// Extensions (M4.2; docs/07 s.4, s.6) ------------------------------------------------------------------------
export const EXTENSION_STATUSES = ["REQUESTED", "APPROVED", "DECLINED", "HELD", "PENDING_PAYMENT", "APPLIED", "EXPIRED", "CANCELLED"] as const;
export type ExtensionStatus = (typeof EXTENSION_STATUSES)[number];
export const extensionSchema = z.object({
  extension_id: z.uuid(),
  booking_id: z.uuid(),
  status: z.enum(EXTENSION_STATUSES),
  additional_minutes: z.number().int(),
  original_end_at: z.string(),
  requested_end_at: z.string(),
  amount_paise: z.number().int(),
  currency: z.literal("INR"),
  request_expires_at: z.string(),
  approval_expires_at: z.string().nullable(),
  hold_expires_at: z.string().nullable(),
  decline_reason: z.string().nullable(),
  applied_at: z.string().nullable(),
  end_reason: z.string().nullable(),
  version: z.number().int(),
  payment_order_id: z.uuid().nullable(),
  server_now: z.string()
});
export type Extension = z.infer<typeof extensionSchema>;
export const extensionRequestSchema = z.strictObject({ additional_minutes: z.number().int().min(5).max(240), expected_version: z.number().int().positive() });
export const extensionDecisionSchema = z.strictObject({
  decision: z.enum(["APPROVE", "DECLINE"]),
  reason: z.string().trim().min(3).max(300).optional(),
  expected_version: z.number().int().positive()
});
export const extensionHoldSchema = z.strictObject({ accepted_price_paise: z.number().int().positive(), expected_version: z.number().int().positive() });
export const staffExtensionSchema = z.object({
  extension_id: z.uuid(), booking_id: z.uuid(), public_ref: z.string(), resource_label: z.string(), additional_minutes: z.number().int(),
  original_end_at: z.string(), requested_end_at: z.string(), status: z.enum(EXTENSION_STATUSES), request_expires_at: z.string(),
  approval_expires_at: z.string().nullable(), hold_expires_at: z.string().nullable(), version: z.number().int(), feasible: z.boolean()
});
export type StaffExtension = z.infer<typeof staffExtensionSchema>;

// Reviews and support (M4.5; docs/07 s.3-4) --------------------------------------------------------------------
export const reviewSchema = z.object({
  review_id: z.uuid(), booking_id: z.uuid(), rating: z.number().int(), body: z.string().nullable(),
  moderation_status: z.enum(["PENDING", "PUBLISHED", "HIDDEN"]), created_at: z.string(), version: z.number().int()
});
export type Review = z.infer<typeof reviewSchema>;
export const reviewCreateSchema = z.strictObject({ rating: z.number().int().min(1).max(5), body: z.string().trim().max(2000).optional() });
export const reviewModerationSchema = z.strictObject({
  decision: z.enum(["PUBLISH", "HIDE"]), reason: z.string().trim().min(3).max(500).optional(), expected_version: z.number().int().positive()
});
export const TICKET_CATEGORIES = ["BOOKING", "PAYMENT", "REFUND", "VENUE", "SAFETY", "ACCOUNT", "OTHER"] as const;
export const TICKET_CATEGORY_LABEL: Record<(typeof TICKET_CATEGORIES)[number], string> = {
  BOOKING: "A booking", PAYMENT: "A payment", REFUND: "A refund", VENUE: "The venue", SAFETY: "Safety (confidential)", ACCOUNT: "My account",
  OTHER: "Something else"
};
export const ticketCreateSchema = z.strictObject({
  booking_id: z.uuid().optional(), category: z.enum(TICKET_CATEGORIES), description: z.string().trim().min(10).max(5000)
});
export const incidentCreateSchema = z.strictObject({
  venue_id: z.uuid(), booking_id: z.uuid().optional(), category: z.enum(TICKET_CATEGORIES), description: z.string().trim().min(10).max(5000),
  sensitive: z.boolean().default(false)
});
export const ticketSchema = z.object({
  ticket_id: z.uuid(), public_ref: z.string(), category: z.enum(TICKET_CATEGORIES), status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]),
  priority: z.enum(["NORMAL", "HIGH", "URGENT"]), description: z.string(), is_sensitive: z.boolean(), booking_ref: z.string().nullable(),
  venue_name: z.string().nullable(), customer_visible_resolution: z.string().nullable(), resolved_at: z.string().nullable(),
  created_at: z.string(), updated_at: z.string(), version: z.number().int()
});
export type Ticket = z.infer<typeof ticketSchema>;
export const ticketUpdateSchema = z.strictObject({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["NORMAL", "HIGH", "URGENT"]).optional(),
  assign_to: z.uuid().optional(),
  customer_visible_resolution: z.string().trim().min(3).max(2000).optional(),
  note: z.string().trim().min(1).max(5000).optional(),
  expected_version: z.number().int().positive()
});
export const contactRevealSchema = z.strictObject({ reason: z.string().trim().min(10).max(500) });
export const bookingSearchQuerySchema = z.strictObject({
  ref: z.string().trim().max(20).optional(), venue_id: z.uuid().optional(), date: z.iso.date().optional(), email: z.email().max(254).optional()
});
export const EMERGENCY_NUMBER = "112";

// Notifications (M4.6; docs/01 PRD-11). In-app rows are durable; the copy is rendered from the template on each client.
export const notificationSchema = z.object({
  notification_id: z.uuid(),
  template: z.string(),
  created_at: z.string(),
  read_at: z.string().nullable(),
  booking_id: z.uuid().nullable(),
  public_ref: z.string().nullable(),
  venue_name: z.string().nullable(),
  ticket_id: z.uuid().nullable()
});
export type AppNotification = z.infer<typeof notificationSchema>;
export const notificationPageSchema = z.object({
  notifications: z.array(notificationSchema),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
  unread: z.number().int()
});
export type NotificationPage = z.infer<typeof notificationPageSchema>;
export const notificationListQuerySchema = z.strictObject({ cursor: z.string().max(20).optional() });
export const notificationReadResultSchema = z.object({ marked: z.number().int(), unread: z.number().int() });
// Notification preferences (PUT /me/notification-preferences). Essential messages are not switchable; `email_copies`
// covers optional email copies and `marketing` is a stored choice only (nothing sends marketing).
export const notificationPreferencesInputSchema = z.strictObject({ email_copies: z.boolean(), marketing: z.boolean() });
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesInputSchema>;
export const notificationPreferencesSchema = z.object({ email_copies: z.boolean(), marketing: z.boolean(), updated_at: z.string().nullable() });
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

const NOTIFICATION_COPY: Record<string, (n: { ref: string; venue: string }) => { title: string; body: string }> = {
  booking_confirmed: (n) => ({ title: "Booking confirmed", body: `${n.ref} at ${n.venue} is confirmed. Your arrival code is on the booking.` }),
  booking_cancelled: (n) => ({ title: "Booking cancelled", body: `${n.ref} at ${n.venue} was cancelled. Any refund is shown on the booking.` }),
  booking_no_show: (n) => ({ title: "Marked as a no-show", body: `${n.ref} at ${n.venue} was marked as a no-show after the grace period.` }),
  booking_ending: (n) => ({ title: "Your time is nearly up", body: `${n.ref} at ${n.venue} ends soon. Need more time? Ask from your booking.` }),
  refund_pending: (n) => ({ title: "Refund requested", body: `A refund for ${n.ref} is with the payment provider. It is not complete yet.` }),
  refund_processed: (n) => ({ title: "Refund complete", body: `The payment provider confirmed your refund for ${n.ref}.` }),
  refund_delayed: (n) => ({ title: "Refund delayed", body: `Your refund for ${n.ref} is delayed. It is still owed to you and support is following up.` }),
  extension_approved: (n) => ({ title: "More time approved", body: `${n.venue} approved more time for ${n.ref}. Pay within five minutes to keep it.` }),
  extension_declined: (n) => ({ title: "More time not available", body: `${n.venue} could not extend ${n.ref}. Your booking is unchanged.` }),
  extension_expired: (n) => ({ title: "Extension expired", body: `The extension for ${n.ref} expired. Your booking is unchanged.` }),
  extension_applied: (n) => ({ title: "Booking extended", body: `${n.ref} at ${n.venue} now ends later. The new end time is on the booking.` }),
  ticket_reply: () => ({ title: "Support replied", body: "Simply Sit support replied to your request." }),
  ticket_resolved: () => ({ title: "Request resolved", body: "Your support request was marked resolved." }),
  ticket_closed: () => ({ title: "Request closed", body: "Your support request was closed." }),
  review_published: (n) => ({ title: "Review published", body: `Your review of ${n.venue} is now on the venue page.` }),
  review_hidden: (n) => ({ title: "Review not published", body: `Your review of ${n.venue} did not meet the review guidelines.` })
};

export function notificationCopy(n: Pick<AppNotification, "template" | "public_ref" | "venue_name">): { title: string; body: string } {
  const render = NOTIFICATION_COPY[n.template];
  const context = { ref: n.public_ref ?? "your booking", venue: n.venue_name ?? "the venue" };
  return render ? render(context) : { title: "Update", body: "There is an update on your account." };
}

// Business metrics (M4.6; docs/07 GET /admin/metrics). Aggregates only; periods are IST calendar days.
export const metricsQuerySchema = z.strictObject({ from: z.iso.date(), to: z.iso.date(), venue_id: z.uuid().optional() });
export const METRIC_DEFINITIONS = {
  conversion: "Holds created in the period that were paid and confirmed, as a share of all holds created in the period.",
  expired_unpaid: "Holds created in the period that expired before a verified payment.",
  no_show_rate: "Paid bookings starting in the period that were marked no-show, as a share of paid bookings starting in the period.",
  cancellations: "Paid bookings starting in the period cancelled by the customer or by the venue/Simply Sit (service).",
  occupancy: "Paid, not cancelled table-minutes starting in the period, divided by bookable table-minutes from current opening hours of published venues (closures not deducted).",
  repeat: "Customers with a paid booking starting in the period who had an earlier paid booking, as a share of those customers.",
  extensions_in_time: "Extension requests created in the period that staff decided before the five-minute deadline.",
  refunds: "Refunds requested in the period by outcome; median minutes from request to provider confirmation.",
  check_in_failures: "Failed arrival-code attempts as a share of all attempts in the period.",
  end_reminders: "In-app end-of-booking reminders created in the period. A booking ends whether or not a reminder was sent.",
  collected: "Captured payments in the period. Collected money is not revenue: it may still be refunded.",
  earned: "Recognised earnings of finished bookings in the period (after refunds), split into partner earnings and platform fees.",
  reconciliation: "Whether a matched reconciliation covers the whole period (MATCHED), part of it (PARTIAL), found differences (MISMATCH) or none ran (NONE). Figures are unreconciled unless MATCHED."
} as const;
export type BusinessMetrics = {
  from: string;
  to: string;
  timezone: string;
  venue_id: string | null;
  funnel: { holds: number; paid: number; expired_unpaid: number; abandoned: number };
  outcomes: { paid_bookings: number; completed: number; no_show: number; customer_cancelled: number; service_cancelled: number; in_progress: number };
  occupancy: { booked_minutes: number; open_minutes: number };
  repeat: { customers: number; repeat_customers: number };
  reliability: {
    extension_requests: number; extensions_decided_in_time: number; extensions_applied: number; refunds_requested: number;
    refunds_processed: number; refunds_failed_or_unknown: number; median_refund_minutes: number | null; check_in_attempts: number;
    check_in_failures: number; end_reminders: number;
  };
  finance: {
    collected_paise: number; refunded_paise: number; earned_gross_paise: number; platform_fee_paise: number; partner_earned_paise: number;
    reconciliation: "MATCHED" | "PARTIAL" | "MISMATCH" | "NONE";
  } | null;
  generated_at: string;
};

// Share as a percentage with one decimal, or null when there is nothing to divide by.
export function percentOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part * 1000) / whole) / 10 : null;
}

// Finance and payouts (M4.4; docs/03 A05, P07; docs/07 s.4, s.7). Money is integer paise; the database decides
// what is refundable, earned or payable.
export const adminRefundSchema = z.strictObject({
  booking_id: z.uuid(),
  amount_paise: z.number().int().positive().max(100_000_000),
  charge_to: z.enum(["PARTNER", "PLATFORM"]).optional(),
  reason: z.string().trim().min(10).max(500)
});
export type AdminRefundInput = z.infer<typeof adminRefundSchema>;
// A FAILED refund is still owed: finance retries it (same amount, same liability) with a reason.
export const refundRetrySchema = z.strictObject({ reason: z.string().trim().min(10).max(500) });
export const feeConfigCreateSchema = z.strictObject({
  config_version: z.string().trim().regex(/^[A-Z0-9][A-Z0-9._-]{2,59}$/),
  commission_bps: z.number().int().min(0).max(10_000),
  platform_fixed_paise: z.number().int().min(0).max(1_000_000),
  customer_fee_paise: z.number().int().min(0).max(1_000_000).default(0),
  effective_from: z.iso.datetime({ offset: true })
});
export const reconciliationRequestSchema = z.strictObject({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true })
});
export const payoutCreateSchema = z.strictObject({ partner_id: z.uuid() });
export const PAYOUT_STATUSES = ["DRAFT", "APPROVED", "PROCESSING", "PAID", "FAILED", "CANCELLED"] as const;
export const payoutMarkSchema = z.strictObject({
  status: z.enum(["PROCESSING", "PAID", "FAILED", "CANCELLED"]),
  expected_version: z.number().int().positive(),
  reference: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,119}$/).optional(),
  reason: z.string().trim().min(3).max(500).optional()
});
export const statementQuerySchema = z.strictObject({
  from: z.iso.date(),
  to: z.iso.date(),
  format: z.enum(["json", "csv"]).default("json")
});
export type StatementLine = {
  booking_id: string; public_ref: string; start_at: string; booking_status: string; gross_paise: number; platform_fee_paise: number;
  partner_paise: number; earned_at: string; payout_ref: string | null; payout_status: string;
};
export type StatementAdjustment = {
  refund_id: string; booking_id: string; public_ref: string; amount_paise: number; refund_status: string; created_at: string;
  payout_ref: string | null; payout_status: string;
};
export type PartnerStatement = {
  venue: { id: string; name: string; timezone: string };
  from: string;
  to: string;
  earnings: StatementLine[];
  adjustments: StatementAdjustment[];
  payouts: { public_ref: string; status: string; venue_amount_paise: number; created_at: string; paid_at: string | null; evidence_ref: string | null }[];
  totals: { gross_paise: number; platform_fee_paise: number; earned_paise: number; adjustments_paise: number; paid_paise: number; unresolved_paise: number };
  not_yet_earned: { count: number; captured_paise: number };
  role: "OWNER" | "MANAGER";
  generated_at: string;
};

export const bookingSummarySchema = z.object({
  booking_id: z.uuid(),
  public_ref: z.string(),
  status: bookingStatusSchema,
  hold_active: z.boolean(),
  start_at: z.string(),
  end_at: z.string(),
  party_size: z.number().int(),
  hold_expires_at: z.string().nullable(),
  confirmed_at: z.string().nullable(),
  checked_in_at: z.string().nullable(),
  checked_out_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  // CUSTOMER / customer reason code, or the venue/platform reason code for a service cancellation.
  cancel_reason: z.string().nullable().optional(),
  expired_at: z.string().nullable(),
  total_paise: z.number().int(),
  currency: z.literal("INR"),
  version: z.number().int(),
  venue: z.object({
    id: z.uuid(), slug: z.string(), name: z.string(), address: z.string(), locality: z.string(), timezone: z.string(),
    is_synthetic: z.boolean(), lat: z.number(), lng: z.number()
  }),
  table: z.object({ label: z.string(), capacity: z.number().int() }),
  payment: bookingPaymentSchema.nullable(),
  refunds: z.array(bookingRefundSchema),
  extension: extensionSchema.nullable().optional(),
  extensions_applied: z.array(z.object({ extension_id: z.uuid(), additional_minutes: z.number().int(), amount_paise: z.number().int(),
                                          applied_at: z.string() })).default([]),
  review: reviewSchema.nullable().optional(),
  server_now: z.string()
});
export type BookingSummary = z.infer<typeof bookingSummarySchema>;

export const bookingDetailSchema = bookingSummarySchema.extend({
  price_snapshot: priceSnapshotSchema,
  policy_snapshot: policySnapshotSchema,
  // Only for the owner while CONFIRMED or CHECKED_IN. Never logged, never put in a URL.
  arrival: z.object({ qr_token: z.string(), pin: z.string().regex(/^\d{6}$/) }).nullable()
});
export type BookingDetail = z.infer<typeof bookingDetailSchema>;

export const bookingListSchema = z.object({
  bookings: z.array(bookingSummarySchema),
  total: z.number().int(),
  next_cursor: z.string().nullable()
});
export type BookingList = z.infer<typeof bookingListSchema>;

export const bookingListQuerySchema = z.strictObject({
  scope: z.enum(["upcoming", "past", "all"]).default("upcoming"),
  cursor: z.string().max(40).optional()
});

// Checkout and payment (docs/07 s.3) ---------------------------------------------------------------------------
export const cancelHoldRequestSchema = z.strictObject({ expected_version: z.number().int().positive() });
// Where the provider sends the customer back. Allowlisted targets only; never a URL from the client.
export const CHECKOUT_CLIENTS = ["web", "native-dev", "native-preview"] as const;
export const checkoutRequestSchema = z.strictObject({
  expected_version: z.number().int().positive(),
  client: z.enum(CHECKOUT_CLIENTS).default("web")
});
export const paymentOrderQuerySchema = z.strictObject({ client: z.enum(CHECKOUT_CLIENTS).default("web") });

// What a client needs to open the provider's checkout. No secret key ever appears here.
export const checkoutConfigSchema = z.object({
  mode: z.literal("mock"),
  provider: z.literal("mock"),
  environment: z.literal("TEST"),
  key_id: z.string(),
  provider_order_id: z.string(),
  amount_paise: z.number().int(),
  currency: z.literal("INR"),
  checkout_url: z.string()
});
export type CheckoutConfig = z.infer<typeof checkoutConfigSchema>;

export const paymentOrderStatusSchema = z.object({
  payment_order_id: z.uuid(),
  booking_id: z.uuid(),
  // Set when this order pays for an extension (M4.2); the outcome is then the extension's, shown via booking.extension.
  extension_id: z.uuid().nullable().default(null),
  state: z.enum(["CREATED", "ORDER_PENDING", "READY", "UNKNOWN", "EXPIRED"]),
  expected_amount_paise: z.number().int(),
  currency: z.literal("INR"),
  expires_at: z.string(),
  booking: bookingSummarySchema,
  checkout: checkoutConfigSchema.nullable(),
  next_poll_after_seconds: z.number().int().nullable()
});
export type PaymentOrderStatus = z.infer<typeof paymentOrderStatusSchema>;

// The provider's redirect/callback values. Hints only: the server fetches the payment itself before acting.
export const verifyRequestSchema = z.strictObject({
  provider_payment_id: z.string().regex(/^[A-Za-z0-9_]{1,120}$/).optional(),
  signature: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  status: z.enum(["success", "failed", "cancelled", "pending"]).optional()
});

// Cancellation (docs/07 s.3-4, docs/03 C10) ---------------------------------------------------------------------
export const CUSTOMER_CANCEL_REASONS = ["CHANGE_OF_PLANS", "FOUND_ALTERNATIVE", "VENUE_ISSUE", "OTHER"] as const;
export const SERVICE_CANCEL_REASONS = ["VENUE_UNAVAILABLE", "VENUE_CLOSED", "TABLE_UNAVAILABLE", "SAFETY", "OTHER"] as const;
export type CustomerCancelReason = (typeof CUSTOMER_CANCEL_REASONS)[number];
export type ServiceCancelReason = (typeof SERVICE_CANCEL_REASONS)[number];

export const cancellationTermsSchema = z.object({
  window: z.enum(["EARLY", "LATE", "SERVICE"]),
  refund_bps: z.number().int(),
  captured_paise: z.number().int(),
  refund_paise: z.number().int(),
  retained_paise: z.number().int(),
  cutoff_minutes: z.number().int(),
  minutes_before_start: z.number().int(),
  policy_version: z.number().int(),
  terms_change_at: z.string().nullable()
});

export const cancelPreviewSchema = cancellationTermsSchema.extend({
  booking_id: z.uuid(),
  booking_version: z.number().int(),
  currency: z.literal("INR"),
  preview_expires_at: z.string(),
  server_now: z.string()
});
export type CancelPreview = z.infer<typeof cancelPreviewSchema>;

export const cancelRequestSchema = z.strictObject({
  reason_code: z.enum(CUSTOMER_CANCEL_REASONS).optional(),
  expected_version: z.number().int().positive(),
  expected_refund_paise: paiseSchema
});

export const serviceCancelRequestSchema = z.strictObject({
  reason_code: z.enum(SERVICE_CANCEL_REASONS),
  reason: z.string().trim().min(3).max(500),
  expected_version: z.number().int().positive()
});

export const cancelResultSchema = z.object({
  booking_id: z.uuid(),
  public_ref: z.string(),
  status: z.literal("CANCELLED"),
  cancelled_at: z.string(),
  version: z.number().int(),
  refund_paise: z.number().int(),
  retained_paise: z.number().int(),
  refund_id: z.uuid().nullable(),
  refund_status: z.string().nullable(),
  window: z.enum(["EARLY", "LATE", "SERVICE"])
});
export type CancelResult = z.infer<typeof cancelResultSchema>;

// Customer-facing cancellation copy, shared by web and native so both say the same thing.
function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 0 ? "" : `${h} hour${h === 1 ? "" : "s"}`;
  const mins = m === 0 ? "" : `${m} minute${m === 1 ? "" : "s"}`;
  return [hours, mins].filter(Boolean).join(" ") || "0 minutes";
}

export function cancellationPolicySummary(policy: { cancel_cutoff_minutes: number; early_refund_bps: number; late_refund_bps: number }): string {
  const cutoff = durationText(policy.cancel_cutoff_minutes);
  const pct = (bps: number) => (bps === 10000 ? "Full refund" : bps === 0 ? "No refund" : `${bps / 100}% refund`);
  if (policy.early_refund_bps === 10000 && policy.late_refund_bps === 0) {
    return `Full refund if you cancel at least ${cutoff} before the start; no refund after that.`;
  }
  return `${pct(policy.early_refund_bps)} if you cancel at least ${cutoff} before the start; ${pct(policy.late_refund_bps).toLowerCase()} after that.`;
}

export const CUSTOMER_CANCEL_REASON_LABEL: Record<CustomerCancelReason, string> = {
  CHANGE_OF_PLANS: "My plans changed",
  FOUND_ALTERNATIVE: "I found another place",
  VENUE_ISSUE: "A problem with the venue",
  OTHER: "Another reason"
};

const SERVICE_CANCEL_REASON_TEXT: Record<ServiceCancelReason, string> = {
  VENUE_UNAVAILABLE: "the venue is unavailable",
  VENUE_CLOSED: "the venue is closed",
  TABLE_UNAVAILABLE: "the table is unavailable",
  SAFETY: "a safety issue",
  OTHER: "an operational reason"
};

// Who cancelled and why, from bookings.cancel_reason: "CUSTOMER:<code>" or "SERVICE:<code>" (namespaced because both
// reason lists contain OTHER).
export function cancellationNotice(cancelReason: string | null | undefined): string {
  if (cancelReason?.startsWith("SERVICE:")) {
    const text = SERVICE_CANCEL_REASON_TEXT[cancelReason.slice("SERVICE:".length) as ServiceCancelReason] ?? SERVICE_CANCEL_REASON_TEXT.OTHER;
    return `This booking was cancelled for you because ${text}. You get a full refund.`;
  }
  return "You cancelled this booking.";
}

const REFUND_REASON_TEXT: Record<string, string> = {
  LATE_CAPTURE: "payment completed after the hold ended",
  DUPLICATE_CAPTURE: "duplicate payment",
  CANCELLED_HOLD_CAPTURE: "payment after the hold was released",
  CUSTOMER_CANCEL: "you cancelled",
  SERVICE_CANCEL: "cancelled for you",
  NO_SHOW: "no-show policy",
  ADMIN_REFUND: "refund from Simply Sit support"
};
export const refundReasonText = (code: string) => REFUND_REASON_TEXT[code] ?? "refund";

// CANCELLED is not REFUNDED: only a provider-confirmed refund reads as refunded.
export function refundStatusText(status: string): string {
  if (status === "PROCESSED") return "refunded by the payment provider";
  if (status === "FAILED") return "delayed: the payment provider could not complete it. It is still owed to you and is flagged for follow-up";
  return "in progress, not yet confirmed by the payment provider";
}

// Partner operations and venue review (M4.3; docs/07 s.4) -------------------------------------------------------
const versionField = z.number().int().positive();
const reasonField = z.string().trim().min(3).max(500);
const localTime = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);

export const partnerApplicationSchema = z.strictObject({
  partner_legal_name: z.string().trim().min(2).max(200),
  venue_name: z.string().trim().min(2).max(120),
  category_code: z.enum(CATEGORY_CODES),
  address: z.string().trim().min(5).max(300),
  locality: z.string().trim().min(2).max(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});
export const venueProfileUpdateSchema = z.strictObject({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(3000).optional(),
  address: z.string().trim().min(5).max(300).optional(),
  locality: z.string().trim().min(2).max(120).optional(),
  category_code: z.enum(CATEGORY_CODES).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  expected_version: versionField
});
const minutes = (min: number, max: number) => z.number().int().min(min).max(max);
export const policyDraftSchema = z.strictObject({
  byo_food: foodRuleSchema.optional(),
  byo_details: z.string().trim().min(3).max(1000).optional(),
  outside_delivery: foodRuleSchema.optional(),
  handover_instructions: z.string().trim().min(3).max(1000).optional(),
  house_rules: z.string().trim().min(3).max(2000).optional(),
  cancel_cutoff_minutes: minutes(0, 2880).optional(),
  early_refund_bps: minutes(0, 10000).optional(),
  late_refund_bps: minutes(0, 10000).optional(),
  no_show_refund_bps: minutes(0, 10000).optional(),
  minimum_minutes: minutes(30, 240).optional(),
  increment_minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
  maximum_minutes: minutes(30, 240).optional(),
  buffer_minutes: minutes(0, 60).optional(),
  grace_minutes: minutes(0, 60).optional(),
  lead_minutes: minutes(0, 1440).optional(),
  max_horizon_days: minutes(1, 90).optional(),
  end_reminder_minutes: minutes(0, 60).optional()
});
export const resourceCreateSchema = z.strictObject({
  label: z.string().trim().min(1).max(80),
  capacity: z.number().int().min(1).max(50),
  hourly_paise: z.number().int().min(100).max(10_000_000)
});
export const resourceUpdateSchema = z.strictObject({
  label: z.string().trim().min(1).max(80).optional(),
  capacity: z.number().int().min(1).max(50).optional(),
  expected_version: versionField
});
export const rateCreateSchema = z.strictObject({
  hourly_paise: z.number().int().min(100).max(10_000_000),
  effective_from: z.iso.datetime({ offset: true }).optional(),
  expected_version: versionField
});
export const resourceStatusSchema = z.strictObject({ reason: reasonField.optional(), expected_version: versionField });
export const hoursUpdateSchema = z.strictObject({
  periods: z.array(z.strictObject({ weekday: z.number().int().min(0).max(6), opens_local: localTime, closes_local: localTime })).max(21),
  expected_version: versionField
});
export const amenitiesTagsUpdateSchema = z.strictObject({
  amenities: z.array(z.strictObject({ code: z.enum(AMENITY_CODES), details: z.string().trim().max(500).optional() })).max(20),
  tags: z.array(z.union([
    z.strictObject({ group: z.literal("REQUIREMENT"), code: z.enum(REQUIREMENT_TAGS) }),
    z.strictObject({ group: z.literal("ENVIRONMENT"), code: z.enum(ENVIRONMENT_TAGS) })
  ])).max(20),
  expected_version: versionField
});
export const venueClosureSchema = z.strictObject({
  resource_ids: z.array(z.uuid()).min(1).max(100).nullable(),
  start_at: z.iso.datetime({ offset: true }),
  end_at: z.iso.datetime({ offset: true }),
  reason: reasonField
});
export const reasonSchema = z.strictObject({ reason: reasonField });
export const staffInviteSchema = z.strictObject({ email: z.email().max(254), role: z.enum(["STAFF", "MANAGER"]) });
// The token from the invitation email's link (base64url HMAC, M5.1 review F1).
export const invitationAcceptSchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const VENUE_REVIEW_DECISIONS = ["APPROVE", "REQUEST_CHANGES", "REJECT", "PAUSE", "RESUME"] as const;
export const venueReviewSchema = z.strictObject({ decision: z.enum(VENUE_REVIEW_DECISIONS), reason: reasonField, expected_version: versionField });
export const policyReviewSchema = z.strictObject({ decision: z.enum(["APPROVE", "REQUEST_CHANGES"]), reason: reasonField, expected_version: versionField });
export const mediaReviewSchema = z.strictObject({ decision: z.enum(["APPROVE", "REJECT"]), reason: z.string().trim().max(500).optional() });
export const calendarQuerySchema = z.strictObject({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) });
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;

// Staff arrival (docs/07 s.4) ----------------------------------------------------------------------------------
export const PUBLIC_REF_PATTERN = /^SS-[A-HJ-KM-NP-Z2-9]{10}$/;
export const checkInRequestSchema = z
  .strictObject({
    venue_id: z.uuid(),
    qr_token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/).optional(),
    public_ref: z.string().trim().toUpperCase().regex(PUBLIC_REF_PATTERN).optional(),
    pin: z.string().regex(/^\d{6}$/).optional()
  })
  .refine((v) => (v.qr_token ? !v.public_ref && !v.pin : !!v.public_ref && !!v.pin), {
    message: "Provide either the QR code or the booking reference and PIN"
  });
export const expectedVersionSchema = z.strictObject({ expected_version: z.number().int().positive() });

export const arrivalsQuerySchema = z.strictObject({ venue_id: z.uuid(), date: z.iso.date().optional() });

export const staffArrivalsSchema = z.object({
  venue_id: z.uuid(),
  date: z.string(),
  timezone: z.string(),
  server_now: z.string(),
  bookings: z.array(z.object({
    booking_id: z.uuid(),
    public_ref: z.string(),
    status: bookingStatusSchema,
    start_at: z.string(),
    end_at: z.string(),
    party_size: z.number().int(),
    resource_id: z.uuid(),
    table_label: z.string(),
    checked_in_at: z.string().nullable(),
    checked_out_at: z.string().nullable(),
    version: z.number().int()
  })),
  tables: z.array(z.object({
    resource_id: z.uuid(),
    label: z.string(),
    capacity: z.number().int(),
    status: z.string(),
    operational_state: z.enum(["READY", "OCCUPIED", "CLEANING", "OUT_OF_SERVICE"]),
    operational_since: z.string(),
    version: z.number().int()
  }))
});
export type StaffArrivals = z.infer<typeof staffArrivalsSchema>;

export const checkInResultSchema = z.object({
  outcome: z.enum(["CHECKED_IN", "ALREADY_CHECKED_IN"]),
  booking_id: z.uuid(),
  public_ref: z.string(),
  status: bookingStatusSchema,
  checked_in_at: z.string(),
  table_label: z.string(),
  party_size: z.number().int(),
  version: z.number().int()
});
export type CheckInResult = z.infer<typeof checkInResultSchema>;

// Opaque offset cursors for list endpoints. Tampering yields INVALID_CURSOR, not a different query.
export function encodeCursor(offset: number): string {
  return `o${offset.toString(36)}`;
}
export function decodeCursor(cursor: string | undefined): number | "invalid" {
  if (cursor === undefined) return 0;
  const match = /^o([0-9a-z]{1,8})$/.exec(cursor);
  if (!match) return "invalid";
  const value = Number.parseInt(match[1]!, 36);
  return Number.isSafeInteger(value) && value >= 0 && value <= 100_000 ? value : "invalid";
}

export const healthSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  mode: z.literal("mock"),
  providers: z.object({
    payment: z.literal("mock"),
    email: z.literal("mock"),
    maps: z.literal("mock")
  }),
  policyVersion: z.string().min(1),
  checkedAt: z.iso.datetime()
});
export type Health = z.infer<typeof healthSchema>;

// Release switches and client compatibility (M6; docs/06 rollback procedure, docs/08 s.4). The database enforces the
// switches; clients only read them to explain a paused state before the customer starts.
export const RELEASE_SWITCH_KEYS = ["BOOKINGS", "EXTENSIONS", "PAYOUTS"] as const;
export const releaseSwitchChangeSchema = z.strictObject({
  key: z.enum(RELEASE_SWITCH_KEYS),
  is_open: z.boolean(),
  reason: z.string().trim().min(10).max(500),
  expected_version: z.number().int().min(1)
});
export type ReleaseSwitch = {
  key: (typeof RELEASE_SWITCH_KEYS)[number];
  is_open: boolean;
  reason: string | null;
  changed_at: string;
  changed_by_name: string | null;
  version: number;
  can_change: boolean;
};
export const serviceStatusSchema = z.object({
  bookings_open: z.boolean(),
  extensions_open: z.boolean(),
  native_min_version: z.string().nullable()
});
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;

// Native apps send their version in this header; booking-creating routes refuse versions below the server minimum.
export const CLIENT_VERSION_HEADER = "x-simply-sit-client";
const VERSION_PATTERN = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;
export function isVersion(value: string): boolean {
  return VERSION_PATTERN.test(value);
}
// True when `version` is older than `minimum` (numeric major.minor.patch). Unparseable versions count as older.
export function isOlderVersion(version: string, minimum: string): boolean {
  const a = VERSION_PATTERN.exec(version);
  const b = VERSION_PATTERN.exec(minimum);
  if (!b) return false;
  if (!a) return true;
  for (let i = 1; i <= 3; i += 1) {
    const diff = Number(a[i]) - Number(b[i]);
    if (diff !== 0) return diff < 0;
  }
  return false;
}
