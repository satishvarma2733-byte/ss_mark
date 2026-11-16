import { NextResponse } from "next/server";
import type { MockGatewayFaults } from "@simply-sit/providers";
import { allowedOrigins } from "../../../../lib/api";
import { mockGatewayOrNotFound } from "../../../../lib/mock-gateway";

export const dynamic = "force-dynamic";

const CREATE_ORDER_FAULTS = new Set(["unavailable", "timeout_after_create"]);

// Console actions for the local mock provider. Each one behaves like the provider would (late capture, a webhook
// delivered again); none of them touches Simply Sit's own tables.
export async function POST(request: Request) {
  const gateway = mockGatewayOrNotFound();
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) return new NextResponse("Forbidden", { status: 403 });
  const form = await request.formData();
  const action = String(form.get("action") ?? "");

  if (action === "faults") {
    const value = String(form.get("create_order") ?? "");
    const faults: MockGatewayFaults = CREATE_ORDER_FAULTS.has(value) ? { create_order: value as MockGatewayFaults["create_order"] } : {};
    await gateway.setFaults(faults);
  } else if (action === "resend") {
    const event = await gateway.storedWebhook(String(form.get("event_id") ?? ""));
    if (!event) return new NextResponse("Not found", { status: 404 });
    await gateway.deliverWebhook(event).catch(() => 0);
  } else if (action === "capture") {
    const payment = await gateway.capturePayment(String(form.get("payment_id") ?? "")).catch(() => null);
    if (!payment) return new NextResponse("Not capturable", { status: 409 });
    await gateway.deliverWebhook(await gateway.buildWebhook(payment)).catch(() => 0);
  } else {
    return new NextResponse("Bad request", { status: 400 });
  }
  return NextResponse.redirect(new URL("/mock-gateway/console", request.url), 303);
}
