// Display labels for controlled catalogue codes. Shared by server pages and client components.
const LABEL: Record<string, string> = {
  WORK: "Work", MEET: "Meet", WAIT: "Wait", STUDY: "Study", GATHER: "Gather", RELAX: "Relax",
  QUIET: "Quiet", LIVELY: "Lively", OUTDOOR: "Outdoor", SEMI_PRIVATE: "Semi-private",
  CAFE: "Cafe", HOTEL: "Hotel", RESTAURANT: "Restaurant", LOUNGE: "Lounge", BREWERY: "Brewery", WORKSPACE: "Workspace",
  WIFI: "Wi-Fi", POWER_OUTLETS: "Power outlets", AIR_CONDITIONING: "Air conditioning", RESTROOM: "Restroom",
  ACCESSIBLE_ENTRANCE: "Accessible entrance", ACCESSIBLE_RESTROOM: "Accessible restroom", PARKING: "Parking",
  OUTDOOR_SEATING: "Outdoor seating", QUIET_ZONE: "Quiet zone"
};
export const tagLabel = (code: string) => LABEL[code] ?? code;

// Booking states shown to customers. A HOLD whose deadline passed reads as ended even before the sweep records it.
const BOOKING_STATUS: Record<string, string> = {
  HOLD: "Held - payment needed",
  PENDING_PAYMENT: "Held - payment in progress",
  CONFIRMED: "Confirmed",
  CHECKED_IN: "Checked in",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  EXPIRED: "Hold ended",
  NO_SHOW: "Missed (no-show)"
};
export function bookingStatusLabel(status: string, holdActive: boolean): string {
  if ((status === "HOLD" || status === "PENDING_PAYMENT") && !holdActive) return "Hold ended";
  return BOOKING_STATUS[status] ?? status;
}
