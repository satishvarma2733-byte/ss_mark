// Job dispatch, independent of the database so it can be unit tested. The loop (loop.ts) supplies real operations.
// Delivery is at least once: every operation below must be idempotent (business keys / provider idempotency keys).
import type { OutboxJob } from "@simply-sit/db";

export type JobOps = {
  holdExpired(bookingId: string): Promise<void>;
  bookingConfirmed(bookingId: string): Promise<void>;
  bookingCancelled(bookingId: string): Promise<void>;
  bookingNoShow(bookingId: string): Promise<void>;
  invitationCreated(invitationId: string): Promise<void>;
  extensionNotify(bookingId: string, extensionId: string, event: "APPROVED" | "DECLINED" | "EXPIRED" | "APPLIED"): Promise<void>;
  refundRequested(bookingId: string, refundId: string): Promise<void>;
  deliverEmail(notificationId: string): Promise<void>;
  privacyDeleteRequested(requestId: string): Promise<void>;
  // finalAttempt: the last lease of this job; unresolvable events are quarantined instead of retried.
  providerEvent(eventRowId: string, finalAttempt: boolean): Promise<void>;
  submitRefund(refundId: string): Promise<void>;
  diagnostic(businessKey: string, sleepMs: number): Promise<void>;
};

export type JobOutcome = { ok: true } | { ok: false; code: string; retryable: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidField(payload: Record<string, unknown>, name: string): string | null {
  const value = payload[name];
  return typeof value === "string" && UUID.test(value) ? value : null;
}

const BAD_PAYLOAD: JobOutcome = { ok: false, code: "BAD_PAYLOAD", retryable: false };

export async function runJob(
  job: Pick<OutboxJob, "kind" | "business_key" | "safe_payload"> & Partial<Pick<OutboxJob, "attempts" | "max_attempts">>,
  ops: JobOps
): Promise<JobOutcome> {
  const payload = job.safe_payload ?? {};
  try {
    switch (job.kind) {
      case "booking.hold_expired": {
        const id = uuidField(payload, "booking_id");
        if (!id) return BAD_PAYLOAD;
        await ops.holdExpired(id);
        return { ok: true };
      }
      case "booking.confirmed": {
        const id = uuidField(payload, "booking_id");
        if (!id) return BAD_PAYLOAD;
        await ops.bookingConfirmed(id);
        return { ok: true };
      }
      case "booking.cancelled": {
        const id = uuidField(payload, "booking_id");
        if (!id) return BAD_PAYLOAD;
        await ops.bookingCancelled(id);
        return { ok: true };
      }
      case "booking.no_show": {
        const id = uuidField(payload, "booking_id");
        if (!id) return BAD_PAYLOAD;
        await ops.bookingNoShow(id);
        return { ok: true };
      }
      case "invitation.created": {
        const id = uuidField(payload, "invitation_id");
        if (!id) return BAD_PAYLOAD;
        await ops.invitationCreated(id);
        return { ok: true };
      }
      case "extension.notify": {
        const bookingId = uuidField(payload, "booking_id");
        const extensionId = uuidField(payload, "extension_id");
        const event = payload.event;
        if (!bookingId || !extensionId || (event !== "APPROVED" && event !== "DECLINED" && event !== "EXPIRED" && event !== "APPLIED")) {
          return BAD_PAYLOAD;
        }
        await ops.extensionNotify(bookingId, extensionId, event);
        return { ok: true };
      }
      case "refund.requested": {
        const bookingId = uuidField(payload, "booking_id");
        const refundId = uuidField(payload, "refund_id");
        if (!bookingId || !refundId) return BAD_PAYLOAD;
        await ops.refundRequested(bookingId, refundId);
        return { ok: true };
      }
      case "notification.email": {
        const id = uuidField(payload, "notification_id");
        if (!id) return BAD_PAYLOAD;
        await ops.deliverEmail(id);
        return { ok: true };
      }
      case "privacy.delete_requested": {
        const id = uuidField(payload, "request_id");
        if (!id) return BAD_PAYLOAD;
        await ops.privacyDeleteRequested(id);
        return { ok: true };
      }
      case "payment.provider_event": {
        const id = uuidField(payload, "event_row_id");
        if (!id) return BAD_PAYLOAD;
        await ops.providerEvent(id, (job.attempts ?? 1) >= (job.max_attempts ?? 8));
        return { ok: true };
      }
      case "refund.submit": {
        const id = uuidField(payload, "refund_id");
        if (!id) return BAD_PAYLOAD;
        await ops.submitRefund(id);
        return { ok: true };
      }
      case "diagnostic.sleep": {
        const ms = typeof payload.ms === "number" ? Math.min(Math.max(0, payload.ms), 120_000) : 0;
        await ops.diagnostic(job.business_key, ms);
        return { ok: true };
      }
      default:
        return { ok: false, code: "UNKNOWN_KIND", retryable: false };
    }
  } catch (error) {
    // Transient failures (database, provider) are retried with backoff by app.fail_job; never surface raw messages.
    const code = (error as { code?: unknown })?.code;
    return { ok: false, code: typeof code === "string" && /^[A-Z_0-9]{2,40}$/.test(code) ? code : "HANDLER_ERROR", retryable: true };
  }
}
