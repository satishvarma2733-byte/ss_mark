// One worker tick: expire due holds, lease due jobs, run each handler, record the outcome, send due end-of-booking
// reminders, recognise what finished bookings earned, reconcile uncertain or unconfirmed payment orders with the
// provider, and write a heartbeat. Reminders are best effort: a booking ends whether or not one was sent.
// Each step commits in its own short transaction under the least-privilege simply_worker role.
import {
  applyDiagnosticEffect, asWorker, completeJob, expireDueHolds, failJob, invitationDelivery, jobBookingHoldExpired, jobNotifyBooking,
  jobPrivacyDeleteRequested, leaseJobs, markNotification, notificationDelivery, ordersToReconcile, purgeOperationalData, recognizeEarnings,
  recordHeartbeat, recordInvitationToken, sendEndReminders, type Sql
} from "@simply-sit/db";
import { invitationAcceptPath, invitationTokenHash } from "@simply-sit/domain";
import { processProviderEvent, reconcileOrder, reconcileRefunds, submitRefund, type PaymentServices } from "@simply-sit/payments";
import type { EmailProvider } from "@simply-sit/providers";
import { runJob, type JobOps } from "./worker";

export type WorkerState = {
  workerId: string;
  startedAt: Date;
  ticks: number;
  completed: number;
  failed: number;
  expired: number;
  reconciled: number;
  lastError?: string;
};

export type WorkerConfig = { batchSize: number; leaseSeconds: number };

export function createOps(sql: Sql, email: EmailProvider, workerId: string, payments: PaymentServices): JobOps {
  return {
    async holdExpired(bookingId) {
      await asWorker(sql, (tx) => jobBookingHoldExpired(tx, bookingId));
    },
    async bookingConfirmed(bookingId) {
      await asWorker(sql, (tx) => jobNotifyBooking(tx, bookingId, `booking:${bookingId}:confirmed`, "booking_confirmed"));
    },
    async bookingCancelled(bookingId) {
      await asWorker(sql, (tx) => jobNotifyBooking(tx, bookingId, `booking:${bookingId}:cancelled`, "booking_cancelled"));
    },
    async bookingNoShow(bookingId) {
      await asWorker(sql, (tx) => jobNotifyBooking(tx, bookingId, `booking:${bookingId}:no_show`, "booking_no_show"));
    },
    async invitationCreated(invitationId) {
      const delivery = await asWorker(sql, (tx) => invitationDelivery(tx, invitationId));
      if (!delivery || delivery.status !== "INVITED") return; // revoked or accepted before delivery
      // The link carries the accept token (M5.1 review F1). Its hash is stored first, so a sent link always works; the
      // token is derived from the invitation ID, so a retry sends the same link. The link is never logged.
      const recorded = await asWorker(sql, (tx) =>
        recordInvitationToken(tx, invitationId, invitationTokenHash(payments.arrivalSecret, invitationId)));
      if (!recorded) return;
      await email.send({
        to: delivery.email,
        template: "venue_invitation",
        idempotencyKey: `invitation:${invitationId}`,
        values: { accept_path: invitationAcceptPath(payments.arrivalSecret, invitationId) }
      });
    },
    async extensionNotify(bookingId, extensionId, event) {
      await asWorker(sql, (tx) =>
        jobNotifyBooking(tx, bookingId, `extension:${extensionId}:${event.toLowerCase()}`, `extension_${event.toLowerCase()}`));
    },
    async refundRequested(bookingId, refundId) {
      await asWorker(sql, (tx) => jobNotifyBooking(tx, bookingId, `refund:${refundId}:requested`, "refund_pending"));
    },
    async deliverEmail(notificationId) {
      const delivery = await asWorker(sql, (tx) => notificationDelivery(tx, notificationId));
      if (!delivery || delivery.status !== "QUEUED" || delivery.channel !== "EMAIL") return; // replay: already handled
      if (!delivery.to_email) {
        await asWorker(sql, (tx) => markNotification(tx, notificationId, "FAILED", null));
        return;
      }
      // The notification ID is the provider idempotency key, so a resend after a crash is deduplicated.
      const result = await email.send({ to: delivery.to_email, template: delivery.template, idempotencyKey: notificationId });
      await asWorker(sql, (tx) => markNotification(tx, notificationId, "SENT", result.messageId));
    },
    async privacyDeleteRequested(requestId) {
      await asWorker(sql, (tx) => jobPrivacyDeleteRequested(tx, requestId));
    },
    async providerEvent(eventRowId, finalAttempt) {
      await processProviderEvent(payments, eventRowId, finalAttempt);
    },
    async submitRefund(refundId) {
      await submitRefund(payments, refundId);
    },
    async diagnostic(businessKey, sleepMs) {
      if (sleepMs > 0) await new Promise((resolve) => setTimeout(resolve, sleepMs));
      const applied = await asWorker(sql, (tx) => applyDiagnosticEffect(tx, businessKey, workerId));
      console.info(`[worker] diagnostic ${businessKey} effect=${applied ? "applied" : "already-applied"}`);
    }
  };
}

// Missing or delayed webhooks and uncertain order creations are resolved by asking the provider (docs/07 s.8).
export async function reconcile(payments: PaymentServices, limit = 20): Promise<number> {
  const orders = await asWorker(payments.sql, (tx) => ordersToReconcile(tx, limit));
  let done = 0;
  for (const order of orders) {
    try {
      const outcomes = await reconcileOrder(payments, order);
      done += 1;
      for (const o of outcomes) {
        if (o.outcome !== "RECORDED") console.info(`[worker] reconcile order ${order.payment_order_id}: ${o.outcome}`);
      }
    } catch (error) {
      console.warn(`[worker] reconcile order ${order.payment_order_id} failed code=${(error as { code?: string })?.code ?? "ERROR"}`);
    }
  }
  return done;
}

export async function tick(sql: Sql, ops: JobOps, state: WorkerState, config: WorkerConfig, payments?: PaymentServices): Promise<void> {
  state.ticks += 1;
  try {
    state.expired += await asWorker(sql, (tx) => expireDueHolds(tx, 200));
    const jobs = await asWorker(sql, (tx) => leaseJobs(tx, state.workerId, config.batchSize, config.leaseSeconds));
    for (const job of jobs) {
      const outcome = await runJob(job, ops);
      if (outcome.ok) {
        const completed = await asWorker(sql, (tx) => completeJob(tx, job.id, state.workerId));
        if (completed) state.completed += 1;
        else console.warn(`[worker] lease lost before completing ${job.kind} ${job.id}; another worker owns it`);
      } else {
        const status = await asWorker(sql, (tx) => failJob(tx, job.id, state.workerId, outcome.code, outcome.retryable));
        state.failed += 1;
        state.lastError = outcome.code;
        console.warn(`[worker] job ${job.kind} ${job.id} failed code=${outcome.code} attempt=${job.attempts} -> ${status}`);
      }
    }
    const reminded = await asWorker(sql, (tx) => sendEndReminders(tx, 100)).catch((error: unknown) => {
      console.warn(`[worker] end reminders failed code=${(error as { code?: string })?.code ?? "ERROR"}`);
      return 0;
    });
    if (reminded > 0) console.info(`[worker] end reminders queued=${reminded}`);
    const earned = await asWorker(sql, (tx) => recognizeEarnings(tx, 100));
    if (earned > 0) console.info(`[worker] earnings recognised=${earned}`);
    // Expired operational caches, about once a minute (retention of personal data awaits decision D09).
    if (state.ticks % 60 === 1) {
      const purged = await asWorker(sql, (tx) => purgeOperationalData(tx, 500));
      if (purged.idempotency_records + purged.quotes > 0) {
        console.info(`[worker] purged idempotency_records=${purged.idempotency_records} quotes=${purged.quotes}`);
      }
    }
    if (payments) {
      state.reconciled += await reconcile(payments);
      const refunds = await reconcileRefunds(payments).catch((error: unknown) => {
        console.warn(`[worker] refund reconciliation failed code=${(error as { code?: string })?.code ?? "ERROR"}`);
        return { checked: 0, processed: 0 };
      });
      if (refunds.checked > 0) console.info(`[worker] refunds re-submitted=${refunds.checked} processed=${refunds.processed}`);
    }
  } catch (error) {
    state.lastError = (error as { code?: string })?.code ?? "TICK_ERROR";
    console.error(`[worker] tick failed code=${state.lastError}`);
  } finally {
    await asWorker(sql, (tx) =>
      recordHeartbeat(tx, {
        workerId: state.workerId,
        startedAt: state.startedAt,
        ticks: state.ticks,
        completed: state.completed,
        failed: state.failed,
        expired: state.expired,
        ...(state.lastError ? { lastError: state.lastError } : {})
      })
    ).catch(() => {
      // Heartbeat failure must not crash the loop; the missing heartbeat is itself the alert signal.
    });
  }
}
