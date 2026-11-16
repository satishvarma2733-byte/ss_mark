// Remembers which payment order the customer left the app to pay, so the next launch can show its server status
// even if the provider's return link is lost (app killed, tab closed, development launcher dropping the URL;
// docs/07 s.8 "App killed/offline/payment redirect lost"). Holds only an order ID, never payment data.
import * as SecureStore from "expo-secure-store";

const KEY = "simplysit.pending_payment";
const MAX_AGE_MS = 30 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function rememberPendingPayment(orderId: string): Promise<void> {
  if (!UUID.test(orderId)) return;
  await SecureStore.setItemAsync(KEY, JSON.stringify({ orderId, at: Date.now() })).catch(() => undefined);
}

export async function pendingPayment(): Promise<string | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { orderId?: unknown; at?: unknown };
    if (typeof value.orderId !== "string" || !UUID.test(value.orderId) || typeof value.at !== "number" || Date.now() - value.at > MAX_AGE_MS) {
      await clearPendingPayment();
      return null;
    }
    return value.orderId;
  } catch {
    return null;
  }
}

export async function clearPendingPayment(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
}
