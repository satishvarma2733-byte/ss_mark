// Reviews, support tickets, confidential incidents and the admin booking lookup (M4.5). Thin wrappers; visibility and
// audit rules live in the app.* functions.
import type postgres from "postgres";

type Tx = postgres.TransactionSql;
type Json = Record<string, unknown>;

async function callJson<T = Json>(query: postgres.PendingQuery<postgres.Row[]>): Promise<T> {
  const rows = await query;
  return rows[0]?.result as T;
}

export function createReview(tx: Tx, bookingId: string, rating: number, body: string | null, requestId: string | null = null) {
  return callJson(tx`select app.create_review(${bookingId}::uuid, ${rating}::integer, ${body}, ${requestId}::uuid) as result`);
}

export function moderateReview(
  tx: Tx,
  reviewId: string,
  input: { decision: "PUBLISH" | "HIDE"; reason?: string | undefined; expected_version: number },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.moderate_review(${reviewId}::uuid, ${input.decision}, ${input.reason ?? null}, ${input.expected_version}::integer,
                               ${requestId}::uuid) as result`);
}

export function adminReviewQueue(tx: Tx, status: string) {
  return callJson<Json[]>(tx`select app.admin_review_queue(${status}) as result`);
}

export function venueReviews(tx: Tx, venueId: string) {
  return callJson<{ count: number; average: number | null; recent: { rating: number; body: string | null; month: string }[] }>(
    tx`select app.venue_reviews(${venueId}::uuid) as result`);
}

export function createTicket(
  tx: Tx,
  input: { booking_id?: string | undefined; category: string; description: string },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.create_ticket(${input.booking_id ?? null}::uuid, ${input.category}, ${input.description}, ${requestId}::uuid) as result`);
}

export function staffReportIncident(
  tx: Tx,
  input: { venue_id: string; booking_id?: string | undefined; category: string; description: string; sensitive: boolean },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.staff_report_incident(${input.venue_id}::uuid, ${input.booking_id ?? null}::uuid, ${input.category}, ${input.description},
                                     ${input.sensitive}, ${requestId}::uuid) as result`);
}

export function myTickets(tx: Tx) {
  return callJson<Json[]>(tx`select app.my_tickets() as result`);
}

export function myTicket(tx: Tx, ticketId: string) {
  return callJson(tx`select app.my_ticket(${ticketId}::uuid) as result`);
}

export function adminTicketQueue(tx: Tx, status: string) {
  return callJson<{ tickets: Json[]; restricted_count: number }>(tx`select app.admin_ticket_queue(${status}) as result`);
}

export function adminTicketDetail(tx: Tx, ticketId: string) {
  return callJson(tx`select app.admin_ticket_detail(${ticketId}::uuid) as result`);
}

export function adminUpdateTicket(
  tx: Tx,
  ticketId: string,
  input: { status?: string | undefined; priority?: string | undefined; assign_to?: string | undefined;
           customer_visible_resolution?: string | undefined; note?: string | undefined; expected_version: number },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.admin_update_ticket(${ticketId}::uuid, ${input.status ?? null}, ${input.priority ?? null}, ${input.assign_to ?? null}::uuid,
                                   ${input.customer_visible_resolution ?? null}, ${input.note ?? null}, ${input.expected_version}::integer,
                                   ${requestId}::uuid) as result`);
}

export function adminTicketContact(tx: Tx, ticketId: string, reason: string, requestId: string | null = null) {
  return callJson<{ ticket_id: string; email: string | null }>(
    tx`select app.admin_ticket_contact(${ticketId}::uuid, ${reason}, ${requestId}::uuid) as result`);
}

export function adminBookingSearch(
  tx: Tx,
  input: { ref?: string | undefined; venue_id?: string | undefined; date?: string | undefined; email?: string | undefined },
  requestId: string | null = null
) {
  return callJson<Json[]>(tx`
    select app.admin_booking_search(${input.ref ?? null}, ${input.venue_id ?? null}::uuid, ${input.date ?? null}::date, ${input.email ?? null},
                                    ${requestId}::uuid) as result`);
}

export function adminBookingDetail(tx: Tx, bookingId: string, requestId: string | null = null) {
  return callJson(tx`select app.admin_booking_detail(${bookingId}::uuid, ${requestId}::uuid) as result`);
}
