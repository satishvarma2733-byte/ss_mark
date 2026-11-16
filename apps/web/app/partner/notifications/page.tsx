import { decodeCursor, encodeCursor } from "@simply-sit/contracts";
import { asUser, getDb, myNotifications } from "@simply-sit/db";
import { PartnerNav, partnerContext } from "../../../lib/partner-page";
import { PortalBlocked } from "../../../lib/portal-page";
import { EmptyState } from "../../../components/ui";
import { NotificationList } from "../../notifications/notification-list";

export const dynamic = "force-dynamic";

// Figma "Notifications · Partner notification centre" (94:21953). Shows the signed-in person's own notifications inside
// the partner workspace (the same inbox as /notifications; nothing is venue-wide or shared between staff).
export default async function PartnerNotificationsPage({ searchParams }: { searchParams: Promise<{ venue?: string; cursor?: string }> }) {
  const sp = await searchParams;
  const ctx = await partnerContext("/partner/notifications", sp.venue);
  if (ctx.state === "blocked") return <PortalBlocked gate={ctx.gate} />;
  if (ctx.state !== "ok") return null;
  const decoded = decodeCursor(sp.cursor);
  const offset = decoded === "invalid" ? 0 : decoded;
  const page = await asUser(getDb(), ctx.gate.identity.claims, (tx) => myNotifications(tx, offset, 30));
  return (
    <main>
      <h1>Notifications</h1>
      <PartnerNav current={ctx.current} memberships={ctx.memberships} active="/partner/notifications" />
      <p className="lede page-lede">Updates sent to you about bookings, refunds and support requests. Each person sees only their own.</p>
      <section className="portal-inbox" aria-label="Your notifications">
        {page.notifications.length === 0 ? (
          <EmptyState title="Nothing yet" description="Updates about bookings, refunds and support requests appear here." />
        ) : (
          <NotificationList notifications={page.notifications} unread={page.unread} />
        )}
        {page.next_offset !== null ? (
          <p>
            <a href={`/partner/notifications?venue=${ctx.current.venue_id}&cursor=${encodeCursor(page.next_offset)}`}>Older notifications</a>
          </p>
        ) : null}
      </section>
    </main>
  );
}
