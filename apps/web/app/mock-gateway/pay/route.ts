import { NextResponse } from "next/server";
import { allowedOrigins } from "../../../lib/api";
import { mockGatewayOrNotFound, parseReturnTarget, returnLocation } from "../../../lib/mock-gateway";

export const dynamic = "force-dynamic";

const OUTCOMES = new Set(["capture", "fail", "authorize", "pending", "cancel"]);

// Form target of the mock checkout page: records the chosen mock payment, delivers the signed webhook as chosen, then
// sends the customer back to an allowlisted return URL with the provider-style callback values.
export async function POST(request: Request) {
  const gateway = mockGatewayOrNotFound();
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) return new NextResponse("Forbidden", { status: 403 });
  const form = await request.formData();
  const providerOrderId = String(form.get("provider_order_id") ?? "");
  const paymentOrderId = String(form.get("ref") ?? "");
  const outcome = String(form.get("outcome") ?? "");
  const webhook = String(form.get("webhook") ?? "now");
  const target = parseReturnTarget(String(form.get("return_to") ?? "web"));
  if (!/^order_mock_[A-Za-z0-9]{14}$/.test(providerOrderId) || !/^[0-9a-f-]{36}$/i.test(paymentOrderId) || !OUTCOMES.has(outcome)) {
    return new NextResponse("Bad request", { status: 400 });
  }
  if (!(await gateway.fetchOrder(providerOrderId))) return new NextResponse("Not found", { status: 404 });

  if (outcome === "cancel") {
    return NextResponse.redirect(returnLocation(gateway, target, { paymentOrderId, providerOrderId, status: "cancelled" }), 303);
  }
  const payment = await gateway.simulatePayment(providerOrderId, outcome as "capture" | "fail" | "authorize" | "pending");
  if (webhook !== "none") {
    const event = await gateway.buildWebhook(payment);
    await gateway.deliverWebhook(event).catch(() => 0);
    if (webhook === "duplicate") await gateway.deliverWebhook(event).catch(() => 0);
  }
  const status = payment.state === "CAPTURED" ? "success" : payment.state === "FAILED" ? "failed" : "pending";
  return NextResponse.redirect(
    returnLocation(gateway, target, { paymentOrderId, providerOrderId, providerPaymentId: payment.providerPaymentId, status }),
    303
  );
}
