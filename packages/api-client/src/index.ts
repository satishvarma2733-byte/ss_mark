// Typed client for the customer/portal web API. Platform-neutral: the caller injects baseUrl, fetch and (for native)
// a bearer-token getter. Responses are validated with shared contracts. Web pages use cookie sessions instead.
import {
  CLIENT_VERSION_HEADER, apiErrorSchema, bookingDetailSchema, serviceStatusSchema, type ServiceStatus, notificationPageSchema, notificationReadResultSchema, type NotificationPage, bookingListSchema, cancelPreviewSchema, cancelResultSchema, extensionSchema, healthSchema, reviewSchema, ticketSchema, holdSchema, meSchema, paymentOrderStatusSchema, quoteSchema,
  venueAvailabilitySchema, venueDetailSchema, venueSearchResultSchema,
  type BookingDetail, type BookingList, type CancelPreview, type CancelResult, type CustomerCancelReason, type Extension, type Health, type Review, type Ticket, type Hold, type Me, type PaymentOrderStatus, type Quote, type VenueAvailability,
  type VenueDetail, type VenueSearchResult
} from "@simply-sit/contracts";

export class ApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId: string;
  readonly status: number;
  readonly fieldErrors: Record<string, string>;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    body: { code: string; message: string; retryable: boolean; field_errors?: Record<string, string>; details?: Record<string, unknown> },
    requestId: string
  ) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.retryable = body.retryable;
    this.fieldErrors = body.field_errors ?? {};
    this.details = body.details ?? {};
    this.requestId = requestId;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ClientOptions = {
  baseUrl: string;
  fetchImpl?: FetchLike;
  // Native apps pass the current Supabase access token. Never logged, never sent to any other origin.
  getAccessToken?: () => Promise<string | null>;
  // Native apps identify as "android/1.2.3" or "ios/1.2.3" so the server can refuse new bookings from a version that
  // is no longer supported (M6). Not a credential.
  clientVersion?: string;
};

export type SearchParams = {
  area?: string;
  lat?: number;
  lng?: number;
  start_at?: string;
  duration_minutes?: number;
  party_size?: number;
  requirement?: string;
  category?: string[];
  environment_tags?: string[];
  amenities?: string[];
  available_only?: boolean;
  cursor?: string;
};

export type CheckoutClient = "web" | "native-dev" | "native-preview";

function queryString(params: Record<string, string | number | boolean | string[] | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    search.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function createSimplySitClient(options: ClientOptions) {
  const fetchFn: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const base = options.baseUrl.replace(/\/$/, "");

  async function request<T>(
    method: "GET" | "POST",
    path: string,
    parse: (value: unknown) => T,
    body?: unknown,
    auth = false,
    idempotencyKey?: string
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    if (options.clientVersion) headers[CLIENT_VERSION_HEADER] = options.clientVersion;
    if (auth) {
      const token = await options.getAccessToken?.();
      if (!token) throw new ApiError(401, { code: "AUTH_REQUIRED", message: "Please sign in to continue.", retryable: false }, "local");
      headers.authorization = `Bearer ${token}`;
    }
    let response: Response;
    try {
      response = await fetchFn(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, { code: "NETWORK", message: "You appear to be offline. Check your connection and try again.", retryable: true }, "local");
    }
    if (response.status === 204) return parse(undefined);
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const envelope = apiErrorSchema.safeParse(json);
      if (envelope.success) throw new ApiError(response.status, envelope.data.error, envelope.data.request_id);
      throw new ApiError(
        response.status,
        { code: "UNEXPECTED_RESPONSE", message: "The service returned an unexpected error.", retryable: response.status >= 500 },
        "unknown"
      );
    }
    return parse(json);
  }

  const data = <T>(parse: (value: unknown) => T) => (value: unknown) => parse((value as { data?: unknown } | null)?.data);

  return {
    getHealth: (): Promise<Health> => request("GET", "/api/v1/health", (value) => healthSchema.parse(value)),
    getServiceStatus: (): Promise<ServiceStatus> => request("GET", "/api/v1/service-status", data((value) => serviceStatusSchema.parse(value))),
    searchVenues: (params: SearchParams = {}): Promise<VenueSearchResult> =>
      request("GET", `/api/v1/venues${queryString(params)}`, data((value) => venueSearchResultSchema.parse(value))),
    getVenue: (venueId: string): Promise<VenueDetail> =>
      request("GET", `/api/v1/venues/${encodeURIComponent(venueId)}`, data((value) => venueDetailSchema.parse(value))),
    getAvailability: (venueId: string, q: { date: string; duration_minutes: number; party_size: number }): Promise<VenueAvailability> =>
      request("GET", `/api/v1/venues/${encodeURIComponent(venueId)}/availability${queryString(q)}`, data((value) => venueAvailabilitySchema.parse(value))),
    getMe: (): Promise<Me> => request("GET", "/api/v1/me", data((value) => meSchema.parse(value)), undefined, true),
    acceptTerms: (termsVersion: string, privacyVersion: string): Promise<Me> =>
      request("POST", "/api/v1/me/terms", data((value) => meSchema.parse(value)),
        { terms_version: termsVersion, privacy_version: privacyVersion }, true),
    requestPrivacy: (kind: "EXPORT" | "DELETE") =>
      request("POST", "/api/v1/privacy-requests", data((value) => value as { request_id: string; status: string }), { kind }, true),
    signOut: (): Promise<void> => request("POST", "/api/v1/auth/sign-out", () => undefined, undefined, true),

    createQuote: (input: { venue_id: string; resource_id: string; start_at: string; duration_minutes: number; party_size: number }): Promise<Quote> =>
      request("POST", "/api/v1/quotes", data((value) => quoteSchema.parse(value)), input, true),
    // idempotencyKey: one per user action, reused on retry, so a repeated tap cannot create a second hold.
    createHold: (quote: Quote, idempotencyKey: string): Promise<Hold> =>
      request("POST", "/api/v1/booking-holds", data((value) => holdSchema.parse(value)), {
        quote_id: quote.quote_id, accepted_policy_hash: quote.policy_hash, expected_quote_total_paise: quote.price_snapshot.total_paise
      }, true, idempotencyKey),
    listBookings: (scope: "upcoming" | "past" | "all" = "upcoming"): Promise<BookingList> =>
      request("GET", `/api/v1/bookings?scope=${scope}`, data((value) => bookingListSchema.parse(value)), undefined, true),
    getBooking: (bookingId: string): Promise<BookingDetail> =>
      request("GET", `/api/v1/bookings/${encodeURIComponent(bookingId)}`, data((value) => bookingDetailSchema.parse(value)), undefined, true),
    cancelHold: (bookingId: string, expectedVersion: number, idempotencyKey: string) =>
      request("POST", `/api/v1/bookings/${encodeURIComponent(bookingId)}/cancel-hold`,
        data((value) => value as { booking_id: string; status: string; version: number }), { expected_version: expectedVersion }, true, idempotencyKey),
    // What cancelling now would refund. Show it, then pass the same refund and version to cancelBooking.
    cancelPreview: (bookingId: string): Promise<CancelPreview> =>
      request("POST", `/api/v1/bookings/${encodeURIComponent(bookingId)}/cancel-preview`, data((value) => cancelPreviewSchema.parse(value)), {}, true),
    // 409 CANCELLATION_CHANGED (details = new terms) when the refund shown no longer applies; ask the customer again.
    cancelBooking: (
      bookingId: string,
      input: { expected_version: number; expected_refund_paise: number; reason_code?: CustomerCancelReason },
      idempotencyKey: string
    ): Promise<CancelResult> =>
      request("POST", `/api/v1/bookings/${encodeURIComponent(bookingId)}/cancel`, data((value) => cancelResultSchema.parse(value)), input, true, idempotencyKey),
    // Extensions (C11). One key per user action, reused on retry. The end time moves only after a verified payment.
    requestExtension: (bookingId: string, additionalMinutes: number, expectedVersion: number, idempotencyKey: string): Promise<Extension> =>
      request("POST", `/api/v1/bookings/${encodeURIComponent(bookingId)}/extension-requests`, data((value) => extensionSchema.parse(value)),
        { additional_minutes: additionalMinutes, expected_version: expectedVersion }, true, idempotencyKey),
    holdExtension: (extensionId: string, acceptedPricePaise: number, expectedVersion: number, idempotencyKey: string): Promise<Extension> =>
      request("POST", `/api/v1/extension-requests/${encodeURIComponent(extensionId)}/hold`, data((value) => extensionSchema.parse(value)),
        { accepted_price_paise: acceptedPricePaise, expected_version: expectedVersion }, true, idempotencyKey),
    startExtensionCheckout: (extensionId: string, expectedVersion: number, client: CheckoutClient): Promise<PaymentOrderStatus> =>
      request("POST", `/api/v1/extension-requests/${encodeURIComponent(extensionId)}/checkout`, data((value) => paymentOrderStatusSchema.parse(value)),
        { expected_version: expectedVersion, client }, true),
    cancelExtension: (extensionId: string): Promise<Extension> =>
      request("POST", `/api/v1/extension-requests/${encodeURIComponent(extensionId)}/cancel`, data((value) => extensionSchema.parse(value)), {}, true),
    // Reviews (C12) and support (C13). Tickets are private to the reporter; support replies on the ticket.
    createReview: (bookingId: string, rating: number, body: string | undefined, idempotencyKey: string): Promise<Review> =>
      request("POST", `/api/v1/bookings/${encodeURIComponent(bookingId)}/reviews`, data((value) => reviewSchema.parse(value)),
        body ? { rating, body } : { rating }, true, idempotencyKey),
    listTickets: (): Promise<Ticket[]> => request("GET", "/api/v1/support-tickets", data((value) => ticketSchema.array().parse(value)), undefined, true),
    getTicket: (ticketId: string): Promise<Ticket> =>
      request("GET", `/api/v1/support-tickets/${encodeURIComponent(ticketId)}`, data((value) => ticketSchema.parse(value)), undefined, true),
    createTicket: (input: { booking_id?: string; category: Ticket["category"]; description: string }, idempotencyKey: string): Promise<Ticket> =>
      request("POST", "/api/v1/support-tickets", data((value) => ticketSchema.parse(value)), input, true, idempotencyKey),
    // In-app notifications (newest first) and read receipts. Reading never changes delivery status.
    listNotifications: (cursor?: string): Promise<NotificationPage> =>
      request("GET", `/api/v1/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        data((value) => notificationPageSchema.parse(value)), undefined, true),
    markNotificationRead: (notificationId: string): Promise<{ marked: number; unread: number }> =>
      request("POST", `/api/v1/notifications/${encodeURIComponent(notificationId)}/read`,
        data((value) => notificationReadResultSchema.parse(value)), {}, true),
    markAllNotificationsRead: (): Promise<{ marked: number; unread: number }> =>
      request("POST", "/api/v1/notifications/read-all", data((value) => notificationReadResultSchema.parse(value)), {}, true),
    // Returns the payment order; `checkout` is null while the provider order is still being set up (HTTP 202).
    startCheckout: (bookingId: string, expectedVersion: number, client: CheckoutClient): Promise<PaymentOrderStatus> =>
      request("POST", `/api/v1/bookings/${encodeURIComponent(bookingId)}/checkout`, data((value) => paymentOrderStatusSchema.parse(value)),
        { expected_version: expectedVersion, client }, true),
    getPaymentOrder: (orderId: string, client: CheckoutClient): Promise<PaymentOrderStatus> =>
      request("GET", `/api/v1/payment-orders/${encodeURIComponent(orderId)}?client=${client}`, data((value) => paymentOrderStatusSchema.parse(value)), undefined, true),
    // The provider's return values are hints; the server fetches the payment itself. Never treat this as "paid".
    verifyPayment: (orderId: string, hint: { provider_payment_id?: string; signature?: string; status?: string } = {}): Promise<PaymentOrderStatus> =>
      request("POST", `/api/v1/payment-orders/${encodeURIComponent(orderId)}/verify`, data((value) => paymentOrderStatusSchema.parse(value)), hint, true)
  };
}

export type SimplySitClient = ReturnType<typeof createSimplySitClient>;
