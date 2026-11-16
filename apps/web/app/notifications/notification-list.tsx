"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { notificationCopy, type AppNotification } from "@simply-sit/contracts";
import { apiCall } from "../../lib/client-api";
import { formatVenueDateTime } from "../../lib/format";

function hrefFor(n: AppNotification): string | null {
  if (n.ticket_id) return `/support/${n.ticket_id}`;
  if (n.booking_id && n.template.startsWith("review_")) return `/bookings/${n.booking_id}/review`;
  return n.booking_id ? `/bookings/${n.booking_id}` : null;
}

// Opening a notification marks it read first (a failed receipt never blocks navigation).
export function NotificationList({ notifications, unread }: { notifications: AppNotification[]; unread: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const open = async (n: AppNotification, href: string | null) => {
    if (!n.read_at) await apiCall("POST", `/api/v1/notifications/${n.notification_id}/read`, { body: {} });
    if (href) router.push(href);
    else router.refresh();
  };
  return (
    <>
      {unread > 0 ? (
        <p className="inline-form">
          <span data-testid="unread-count">{unread} unread</span>
          <button className="button secondary" type="button" disabled={busy} data-testid="mark-all-read" onClick={async () => {
            setBusy(true);
            await apiCall("POST", "/api/v1/notifications/read-all", { body: {} });
            setBusy(false);
            router.refresh();
          }}>
            Mark all as read
          </button>
        </p>
      ) : null}
      <ul className="notification-list" data-testid="notifications">
        {notifications.map((n) => {
          const copy = notificationCopy(n);
          const href = hrefFor(n);
          return (
            <li key={n.notification_id} className={n.read_at ? "card" : "card unread"}>
              <button type="button" className="notification-item" onClick={() => void open(n, href)}
                aria-label={`${n.read_at ? "" : "Unread: "}${copy.title}. ${copy.body}`}>
                <strong>{copy.title}</strong>
                <span>{copy.body}</span>
                <small>{formatVenueDateTime(n.created_at)} IST</small>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
