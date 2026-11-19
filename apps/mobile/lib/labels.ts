// Display labels for controlled catalogue codes (same wording as apps/web/lib/labels.ts).
const LABEL: Record<string, string> = {
  WORK: "Work", MEET: "Meet", WAIT: "Wait", STUDY: "Study", GATHER: "Gather", RELAX: "Relax",
  QUIET: "Quiet", LIVELY: "Lively", OUTDOOR: "Outdoor", SEMI_PRIVATE: "Semi-private",
  CAFE: "Cafe", HOTEL: "Hotel", RESTAURANT: "Restaurant", LOUNGE: "Lounge", BREWERY: "Brewery", WORKSPACE: "Workspace",
  WIFI: "Wi-Fi", POWER_OUTLETS: "Power outlets", AIR_CONDITIONING: "Air conditioning", RESTROOM: "Restroom",
  ACCESSIBLE_ENTRANCE: "Accessible entrance", ACCESSIBLE_RESTROOM: "Accessible restroom", PARKING: "Parking",
  OUTDOOR_SEATING: "Outdoor seating", QUIET_ZONE: "Quiet zone"
};

export const tagLabel = (code: string) => LABEL[code] ?? code;
