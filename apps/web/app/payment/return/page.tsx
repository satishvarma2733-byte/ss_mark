import { redirect } from "next/navigation";
import { resolveIdentity } from "../../../lib/auth/identity";
import { PaymentReturn } from "./payment-return";

export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

// C07 - the provider sends the customer here. These values only tell the server which payment to look up; the page
// shows "confirmed" only when the server's booking record is CONFIRMED.
export default async function PaymentReturnPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const orderId = one(sp.payment_order_id);
  const valid = orderId && /^[0-9a-f-]{36}$/i.test(orderId);
  const identity = await resolveIdentity();
  if (identity.kind !== "user") {
    const back = new URLSearchParams();
    for (const key of ["payment_order_id", "provider_order_id", "provider_payment_id", "signature", "status"]) {
      const value = one(sp[key]);
      if (value) back.set(key, value);
    }
    redirect(`/sign-in?redirect_path=${encodeURIComponent(`/payment/return?${back.toString()}`)}`);
  }
  return (
    <main>
      <h1>Payment status</h1>
      {valid ? (
        <PaymentReturn
          orderId={orderId}
          providerPaymentId={one(sp.provider_payment_id)}
          signature={one(sp.signature)}
          status={one(sp.status)}
        />
      ) : (
        <p className="notice" role="alert">
          This payment link is incomplete. Open <a href="/bookings">your bookings</a> to see the current status.
        </p>
      )}
    </main>
  );
}
