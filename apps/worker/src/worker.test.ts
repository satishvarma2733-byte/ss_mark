import { describe, expect, it } from "vitest";
import { runJob, type JobOps } from "./worker";

const ID = "8f2b7c2e-1d4a-4c3b-9e7f-2a1b3c4d5e6f";

function recordingOps(fail?: Error & { code?: string }) {
  const calls: string[] = [];
  const ops: JobOps = {
    holdExpired: async (id) => {
      if (fail) throw fail;
      calls.push(`hold:${id}`);
    },
    bookingConfirmed: async (id) => {
      calls.push(`confirmed:${id}`);
    },
    bookingCancelled: async (id) => {
      calls.push(`cancelled:${id}`);
    },
    bookingNoShow: async (id) => {
      calls.push(`no-show:${id}`);
    },
    invitationCreated: async (id) => {
      calls.push(`invitation:${id}`);
    },
    extensionNotify: async (bookingId, extensionId, event) => {
      calls.push(`extension:${bookingId}:${extensionId}:${event}`);
    },
    refundRequested: async (bookingId, refundId) => {
      calls.push(`refund-requested:${bookingId}:${refundId}`);
    },
    deliverEmail: async (id) => {
      calls.push(`email:${id}`);
    },
    providerEvent: async (id, finalAttempt) => {
      calls.push(`event:${id}:${finalAttempt}`);
    },
    submitRefund: async (id) => {
      calls.push(`refund:${id}`);
    },
    privacyDeleteRequested: async (id) => {
      calls.push(`privacy:${id}`);
    },
    diagnostic: async (key, ms) => {
      calls.push(`diag:${key}:${ms}`);
    }
  };
  return { ops, calls };
}

describe("runJob", () => {
  it("dispatches each job kind with its validated payload", async () => {
    const { ops, calls } = recordingOps();
    await runJob({ kind: "booking.hold_expired", business_key: "k1", safe_payload: { booking_id: ID } }, ops);
    await runJob({ kind: "notification.email", business_key: "k2", safe_payload: { notification_id: ID } }, ops);
    await runJob({ kind: "privacy.delete_requested", business_key: "k3", safe_payload: { request_id: ID } }, ops);
    await runJob({ kind: "diagnostic.sleep", business_key: "k4", safe_payload: { ms: 999_999 } }, ops);
    expect(calls).toEqual([`hold:${ID}`, `email:${ID}`, `privacy:${ID}`, "diag:k4:120000"]);
  });

  it("dispatches payment jobs and tells the event handler when it is the final attempt", async () => {
    const { ops, calls } = recordingOps();
    await runJob({ kind: "booking.confirmed", business_key: "c", safe_payload: { booking_id: ID } }, ops);
    await runJob({ kind: "booking.cancelled", business_key: "x", safe_payload: { booking_id: ID } }, ops);
    await runJob({ kind: "booking.no_show", business_key: "n", safe_payload: { booking_id: ID } }, ops);
    await runJob({ kind: "invitation.created", business_key: "i", safe_payload: { invitation_id: ID } }, ops);
    await runJob({ kind: "extension.notify", business_key: "e", safe_payload: { booking_id: ID, extension_id: ID, event: "APPROVED" } }, ops);
    expect(await runJob({ kind: "extension.notify", business_key: "e2", safe_payload: { booking_id: ID, extension_id: ID, event: "NOPE" } }, ops))
      .toEqual({ ok: false, code: "BAD_PAYLOAD", retryable: false });
    await runJob({ kind: "refund.requested", business_key: "r", safe_payload: { booking_id: ID, refund_id: ID } }, ops);
    await runJob({ kind: "refund.submit", business_key: "s", safe_payload: { refund_id: ID } }, ops);
    await runJob({ kind: "payment.provider_event", business_key: "e1", safe_payload: { event_row_id: ID }, attempts: 1, max_attempts: 8 }, ops);
    await runJob({ kind: "payment.provider_event", business_key: "e2", safe_payload: { event_row_id: ID }, attempts: 8, max_attempts: 8 }, ops);
    expect(calls).toEqual([`confirmed:${ID}`, `cancelled:${ID}`, `no-show:${ID}`, `invitation:${ID}`, `extension:${ID}:${ID}:APPROVED`, `refund-requested:${ID}:${ID}`, `refund:${ID}`, `event:${ID}:false`, `event:${ID}:true`]);
    expect(await runJob({ kind: "refund.requested", business_key: "r", safe_payload: { booking_id: ID } }, ops))
      .toEqual({ ok: false, code: "BAD_PAYLOAD", retryable: false });
  });

  it("dead-letters malformed payloads and unknown kinds instead of retrying them", async () => {
    const { ops } = recordingOps();
    expect(await runJob({ kind: "booking.hold_expired", business_key: "k", safe_payload: { booking_id: "nope" } }, ops))
      .toEqual({ ok: false, code: "BAD_PAYLOAD", retryable: false });
    expect(await runJob({ kind: "send.sms" as never, business_key: "k", safe_payload: {} }, ops))
      .toEqual({ ok: false, code: "UNKNOWN_KIND", retryable: false });
  });

  it("retries handler errors with a safe code and never surfaces the raw message", async () => {
    const pgError = Object.assign(new Error("connection refused at 10.0.0.1 password=..."), { code: "ECONNREFUSED" });
    const { ops } = recordingOps(pgError);
    expect(await runJob({ kind: "booking.hold_expired", business_key: "k", safe_payload: { booking_id: ID } }, ops))
      .toEqual({ ok: false, code: "ECONNREFUSED", retryable: true });
    const odd = Object.assign(new Error("x"), { code: "weird code!" });
    expect(await runJob({ kind: "booking.hold_expired", business_key: "k", safe_payload: { booking_id: ID } }, recordingOps(odd).ops))
      .toEqual({ ok: false, code: "HANDLER_ERROR", retryable: true });
  });
});
