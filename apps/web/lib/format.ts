// Money is stored and transported as integer paise. Formatting happens only at the display edge.
export function formatInrPaise(paise: number): string {
  if (!Number.isInteger(paise) || paise < 0) throw new Error("Amount must be a non-negative integer in paise");
  const rupees = Math.floor(paise / 100);
  const remainder = String(paise % 100).padStart(2, "0");
  return `₹${rupees.toLocaleString("en-IN")}.${remainder}`;
}

// Balances that can legitimately go below zero (a partner owing a refund adjustment, ledger accounts).
export function formatSignedInrPaise(paise: number): string {
  return paise < 0 ? `-${formatInrPaise(-paise)}` : formatInrPaise(paise);
}

// Venue-local calendar date. Pilot venues are all Asia/Kolkata (fixed UTC+05:30, no DST).
export function venueLocalDate(timezoneOffsetMinutes = 330, at = Date.now()): string {
  return new Date(at + timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

// Venue-local display with the timezone named (docs/02 s.4: store UTC, show venue-local time with its label).
export function formatVenueDateTime(iso: string, timeZone = "Asia/Kolkata"): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(new Date(iso));
}

export function formatVenueTime(iso: string, timeZone = "Asia/Kolkata"): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export const TIMEZONE_LABEL: Record<string, string> = { "Asia/Kolkata": "IST" };

// Pilot venues are IST: a venue-local date and HH:MM become an RFC 3339 instant with the +05:30 offset.
export function istInstant(date: string, time: string): string {
  return `${date}T${time}:00+05:30`;
}

export const FOOD_RULE_LABEL = { ALLOWED: "Allowed", RESTRICTED: "Restricted", NOT_ALLOWED: "Not allowed" } as const;
