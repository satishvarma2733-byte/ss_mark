"use client";

// Extension requests for this venue (P06). Staff must answer within five minutes; approval reserves nothing (the
// customer still has to confirm availability and pay). No prices are shown to staff.
import { useCallback, useEffect, useState } from "react";
import type { StaffExtension } from "@simply-sit/contracts";
import { apiCall, newIdempotencyKey } from "../../lib/client-api";
import { formatVenueTime } from "../../lib/format";
import { Button, Card } from "../../components/ui";

const STATUS: Record<string, string> = {
  APPROVED: "approved - waiting for the guest to pay", HELD: "time held - guest paying", PENDING_PAYMENT: "guest paying"
};

export function StaffExtensions({ venueId }: { venueId: string }) {
  const [items, setItems] = useState<StaffExtension[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await apiCall<StaffExtension[]>("GET", `/api/v1/partner/extension-requests?venue_id=${venueId}`);
    if (result.ok) setItems(result.data);
  }, [venueId]);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), 10_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  async function decide(item: StaffExtension, decision: "APPROVE" | "DECLINE") {
    setBusy(item.extension_id);
    setMessage(null);
    const result = await apiCall("POST", `/api/v1/partner/extension-requests/${item.extension_id}/decision`, {
      idempotencyKey: newIdempotencyKey(),
      body: decision === "DECLINE" ? { decision, reason: "The table is needed", expected_version: item.version } : { decision, expected_version: item.version }
    });
    setBusy(null);
    if (!result.ok) {
      setMessage(result.code === "SLOT_UNAVAILABLE" ? "Not possible: the table is booked right after. Decline instead."
        : result.code === "EXTENSION_EXPIRED" ? "Too late: the request expired." : result.message);
    }
    await load();
  }

  if (items.length === 0) return null;
  return (
    <Card style={{ marginTop: 16 }} aria-labelledby="ext-requests-heading" data-testid="staff-extensions">
      <h2 id="ext-requests-heading">More time requests</h2>
      <ul>
        {items.map((x) => {
          const left = Math.max(0, Math.floor((Date.parse(x.request_expires_at) - now) / 1000));
          return (
            <li key={x.extension_id}>
              <strong>{x.public_ref}</strong> · {x.resource_label} · +{x.additional_minutes} min (until {formatVenueTime(x.requested_end_at)} IST)
              {x.status === "REQUESTED" ? (
                <>
                  {" "}· answer within {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
                  {!x.feasible ? <span className="status-warning"> · table booked right after</span> : null}{" "}
                  <Button type="button" disabled={busy !== null || !x.feasible} onClick={() => void decide(x, "APPROVE")}
                    data-testid={`ext-approve-${x.public_ref}`}>
                    Approve
                  </Button>{" "}
                  <Button variant="secondary" type="button" disabled={busy !== null} onClick={() => void decide(x, "DECLINE")}
                    data-testid={`ext-decline-${x.public_ref}`}>
                    Decline
                  </Button>
                </>
              ) : (
                <> · {STATUS[x.status] ?? x.status.toLowerCase()}</>
              )}
            </li>
          );
        })}
      </ul>
      {message ? <p className="status-error" role="alert">{message}</p> : null}
    </Card>
  );
}
