// Local mock payment provider pages (/mock-gateway/*). They stand in for the provider's hosted checkout so the full
// return/webhook/verification path can run without an account. Server-only; 404 unless the mock gateway is configured
// and APP_ENV is not production (createPaymentGateway enforces both).
import { notFound } from "next/navigation";
import type { CheckoutReturnTarget, MockGateway } from "@simply-sit/providers";
import { getPaymentServices } from "./server-env";

export const RETURN_TARGETS = ["web", "native-dev", "native-preview"] as const satisfies readonly CheckoutReturnTarget[];

export function mockGatewayOrNotFound(): MockGateway {
  try {
    return getPaymentServices().gateway;
  } catch {
    notFound();
  }
}

export function parseReturnTarget(value: string | null | undefined): CheckoutReturnTarget {
  return (RETURN_TARGETS as readonly string[]).includes(value ?? "") ? (value as CheckoutReturnTarget) : "web";
}

// Where the customer lands after the mock checkout: only allowlisted app URLs, never one taken from the request.
export function returnLocation(
  gateway: MockGateway,
  target: CheckoutReturnTarget,
  params: { paymentOrderId: string; providerOrderId: string; providerPaymentId?: string; status: "success" | "failed" | "pending" | "cancelled" }
): string {
  const url = new URL(gateway.returnUrl(target));
  url.searchParams.set("payment_order_id", params.paymentOrderId);
  url.searchParams.set("provider_order_id", params.providerOrderId);
  if (params.providerPaymentId) {
    url.searchParams.set("provider_payment_id", params.providerPaymentId);
    url.searchParams.set("signature", gateway.checkoutSignature(params.providerOrderId, params.providerPaymentId));
  }
  url.searchParams.set("status", params.status);
  return url.toString();
}
