import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { asWorker, DomainError, ingestProviderEvent } from "@simply-sit/db";
import { handle, readBodyCapped } from "../../../../../lib/api";
import { getPaymentServices } from "../../../../../lib/server-env";

export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 64 * 1024;
const ID = /^[A-Za-z0-9_]{1,120}$/;

// POST /api/v1/webhooks/mock - signed provider events (docs/07 s.4, docs/02 s.6). The HMAC is checked over the exact
// raw body before anything is parsed or stored. 200 means durably ingested (deduplicated by provider event ID), not
// processed: the worker fetches the payment from the provider before changing any state. No cookie or bearer identity
// is accepted here; the signature is the only authentication. Only allowlisted fields are kept.
export function POST(request: Request) {
  return handle(async (requestId) => {
    const services = getPaymentServices();
    const raw = await readBodyCapped(request, MAX_WEBHOOK_BYTES);
    if (!services.gateway.verifyWebhookSignature(raw, request.headers.get("x-mock-signature"))) {
      return NextResponse.json({ error: { code: "INVALID_SIGNATURE" }, request_id: requestId }, { status: 401, headers: { "x-request-id": requestId } });
    }

    let event: { id?: unknown; event?: unknown; payload?: { payment?: { entity?: Record<string, unknown> } } };
    try {
      event = JSON.parse(raw) as typeof event;
    } catch {
      throw new DomainError("MALFORMED_REQUEST", { reason: "invalid_json" });
    }
    const entity = event.payload?.payment?.entity ?? {};
    const eventId = event.id;
    const eventType = event.event;
    if (typeof eventId !== "string" || !ID.test(eventId) || typeof eventType !== "string" || !/^[a-z_.]{3,60}$/.test(eventType)) {
      throw new DomainError("MALFORMED_REQUEST", { reason: "event_shape" });
    }
    const safePayload = {
      provider_payment_id: typeof entity.id === "string" && ID.test(entity.id) ? entity.id : null,
      provider_order_id: typeof entity.order_id === "string" && ID.test(entity.order_id) ? entity.order_id : null,
      reported_status: typeof entity.status === "string" ? entity.status.slice(0, 20) : null
    };
    const ingested = await asWorker(services.sql, (tx) =>
      ingestProviderEvent(tx, {
        provider: services.gateway.provider,
        environment: services.gateway.environment,
        event_id: eventId,
        event_type: eventType,
        safe_payload: safePayload,
        payload_hash: createHash("sha256").update(raw, "utf8").digest("hex")
      })
    );
    return NextResponse.json(
      { received: true, duplicate: ingested.duplicate, request_id: requestId },
      { status: 200, headers: { "cache-control": "no-store", "x-request-id": requestId } }
    );
  });
}
