import { redirect } from "next/navigation";
import { decodeCursor, encodeCursor } from "@simply-sit/contracts";
import { asUser, getDb, myNotifications } from "@simply-sit/db";
import { resolveIdentity } from "../../lib/auth/identity";
import { NotificationList } from "./notification-list";

export const dynamic = "force-dynamic";

// In-app notifications (PRD-11): booking, payment, refund, extension, reminder, support and review updates. The same
// events also go by email (MOCK provider: nothing is actually sent).
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const identity = await resolveIdentity();
  if (identity.kind !== "user") redirect("/sign-in?redirect_path=/notifications");
  const decoded = decodeCursor((await searchParams).cursor);
  const offset = decoded === "invalid" ? 0 : decoded;
  const page = await asUser(getDb(), identity.claims, (tx) => myNotifications(tx, offset, 30));
  return (
    <main>
      <h1>Notifications</h1>
      {page.notifications.length === 0 ? (
        <p className="notice" data-testid="notifications-empty">Nothing yet. Updates about your bookings, refunds and support requests appear here.</p>
      ) : (
        <NotificationList notifications={page.notifications} unread={page.unread} />
      )}
      {page.next_offset !== null ? (
        <p>
          <a href={`/notifications?cursor=${encodeCursor(page.next_offset)}`}>Older notifications</a>
        </p>
      ) : null}
    </main>
  );
}
