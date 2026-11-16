// Versioned booking policy. Values are the PROPOSED pilot defaults from docs/01-PRD.md section 5 and docs/02-TRD.md section 4.
// They are not owner-approved commercial terms (decision register D02/D03). A booking will snapshot the version it was quoted under.
// To change a value, add a new version; never edit a version that bookings may already reference.
export type BookingPolicy = {
  version: string;
  status: "proposed" | "approved";
  timezone: "Asia/Kolkata";
  minimumMinutes: number;
  incrementMinutes: number;
  maximumMinutes: number;
  leadMinutes: number;
  horizonDays: number;
  holdMinutes: number;
  cleaningBufferMinutes: number;
  lateGraceMinutes: number;
  endReminderMinutes: number;
  fullRefundCutoffMinutes: number;
};

export const POLICY_PROPOSED_2026_10_25: BookingPolicy = Object.freeze({
  version: "proposed-2026-10-25",
  status: "proposed",
  timezone: "Asia/Kolkata",
  minimumMinutes: 60,
  incrementMinutes: 30,
  maximumMinutes: 240,
  leadMinutes: 15,
  horizonDays: 30,
  holdMinutes: 5,
  cleaningBufferMinutes: 10,
  lateGraceMinutes: 15,
  endReminderMinutes: 10,
  fullRefundCutoffMinutes: 120
});

const POLICIES: Readonly<Record<string, BookingPolicy>> = Object.freeze({
  [POLICY_PROPOSED_2026_10_25.version]: POLICY_PROPOSED_2026_10_25
});

export const CURRENT_POLICY_VERSION = POLICY_PROPOSED_2026_10_25.version;

// Fails closed: an unknown version is an error, never a silent fallback to defaults.
export function getPolicy(version: string = CURRENT_POLICY_VERSION): BookingPolicy {
  const policy = POLICIES[version];
  if (!policy) throw new Error(`Unknown booking policy version: ${version}`);
  return policy;
}
