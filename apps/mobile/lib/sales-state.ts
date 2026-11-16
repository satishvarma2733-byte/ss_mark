// What a customer may start right now, from the server's service status and this app's version (M6). Pure, so it
// is unit-tested without React Native.
import { isOlderVersion, type ServiceStatus } from "@simply-sit/contracts";

export type SaleState = "open" | "paused" | "update";
export type SalesState = { bookings: SaleState; extensions: SaleState; minimumVersion: string | null };

export function salesState(status: ServiceStatus, version: string): SalesState {
  const update = status.native_min_version !== null && isOlderVersion(version, status.native_min_version);
  return {
    bookings: update ? "update" : status.bookings_open ? "open" : "paused",
    extensions: update ? "update" : status.extensions_open ? "open" : "paused",
    minimumVersion: status.native_min_version
  };
}

export const SALE_NOTICE: Record<Exclude<SaleState, "open">, { bookings: string; extensions: string }> = {
  paused: {
    bookings: "New bookings are paused for now. Your existing bookings are not affected.",
    extensions: "Extensions are paused for now. Your booking and its end time are not affected."
  },
  update: {
    bookings: "This version of the app can no longer start new bookings. Update Simply Sit from your app store. Your bookings, receipts and support stay available here.",
    extensions: "This version of the app can no longer request more time. Update Simply Sit from your app store. Your booking is not affected."
  }
};
