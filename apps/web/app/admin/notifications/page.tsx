import { decodeCursor, encodeCursor } from "@simply-sit/contracts";
import { asUser, getDb, myNotifications } from "@simply-sit/db";
import { AdminNav } from "../../../lib/admin-nav";
import { gatePortal, PortalBlocked } from "../../../lib/portal-page";
import { EmptyState } from "../../../components/ui";
import { NotificationList } from "../../notifications/notification-list";

export const dynamic = "force-dynamic";

// Figma "Notifications · Admin notification centre" (94:22194). Shows the signed-in admin's own notifications inside the
// admin workspace (the same inbox as /notifications). Queue alerts live on the overview and finance pages.
export default async function AdminNotificationsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const gate = await gatePortal("/admin/notifications", (me) => me.platform_roles.length > 0);
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const decoded = decodeCursor((await searchParams).cursor);
  const offset = decoded === "invalid" ? 0 : decoded;
  const page = await asUser(getDb(), gate.identity.claims, (tx) => myNotifications(tx, offset, 30));
  return (
    <main>
      <AdminNav roles={gate.me.platform_roles} active="/admin/notifications" />
      <h1>Notifications</h1>
      <p className="lede">Updates sent to you. Marketplace queues and alerts are on Overview, Finance and Trust &amp; support.</p>
      <section className="portal-inbox" aria-label="Your notifications">
        {page.notifications.length === 0 ? (
          <EmptyState title="Nothing yet" description="Updates addressed to you appear here." />
        ) : (
          <NotificationList notifications={page.notifications} unread={page.unread} />
        )}
        {page.next_offset !== null ? (
          <p>
            <a href={`/admin/notifications?cursor=${encodeCursor(page.next_offset)}`}>Older notifications</a>
          </p>
        ) : null}
      </section>
    </main>
  );
}
