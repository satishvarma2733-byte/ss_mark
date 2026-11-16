// Notifications and business metrics (M4.6). Thin wrappers; delivery, dedupe and metric definitions live in the app.*
// functions. End reminders are worker-only.
import type postgres from "postgres";
import type { BusinessMetrics, NotificationPage, NotificationPreferences } from "@simply-sit/contracts";

type Tx = postgres.TransactionSql;

async function callJson<T>(query: postgres.PendingQuery<postgres.Row[]>): Promise<T> {
  const rows = await query;
  return rows[0]?.result as T;
}

export function myNotifications(tx: Tx, offset = 0, limit = 30) {
  return callJson<Omit<NotificationPage, "next_cursor"> & { next_offset: number | null }>(tx`select app.my_notifications(${offset}::integer, ${limit}::integer) as result`);
}

// One notification, or all of the caller's when `notificationId` is null.
export function markNotificationsRead(tx: Tx, notificationId: string | null) {
  return callJson<{ marked: number; unread: number }>(tx`select app.mark_notifications_read(${notificationId}::uuid) as result`);
}

export function myNotificationPreferences(tx: Tx) {
  return callJson<NotificationPreferences>(tx`select app.my_notification_preferences() as result`);
}

export function setNotificationPreferences(tx: Tx, input: { email_copies: boolean; marketing: boolean }) {
  return callJson<NotificationPreferences>(tx`select app.set_notification_preferences(${input.email_copies}::boolean, ${input.marketing}::boolean) as result`);
}

export async function sendEndReminders(tx: Tx, limit = 100): Promise<number> {
  const [row] = await tx`select app.send_end_reminders(${limit}::integer) as count`;
  return Number(row?.count ?? 0);
}

export function adminBusinessMetrics(tx: Tx, input: { from: string; to: string; venue_id?: string | undefined }) {
  return callJson<BusinessMetrics>(tx`
    select app.admin_business_metrics(${input.from}::date, ${input.to}::date, ${input.venue_id ?? null}::uuid) as result`);
}
