// Mirrors apps/web/lib/format.ts. Money stays in integer paise until the display edge.
export function formatInrPaise(paise: number): string {
  if (!Number.isInteger(paise) || paise < 0) throw new Error("Amount must be a non-negative integer in paise");
  const rupees = Math.floor(paise / 100);
  const remainder = String(paise % 100).padStart(2, "0");
  return `₹${rupees.toLocaleString("en-IN")}.${remainder}`;
}

// Pilot venues are all Asia/Kolkata (fixed UTC+05:30, no DST). Formatting is done by offset so it does not depend on
// the device's time zone or on Intl time-zone support in the JS engine.
const IST_MS = 330 * 60_000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ist(iso: string | number): Date {
  return new Date((typeof iso === "number" ? iso : Date.parse(iso)) + IST_MS);
}

export function formatIstTime(iso: string): string {
  const d = ist(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function formatIstDate(iso: string | number): string {
  const d = ist(iso);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function formatIstDateTime(iso: string): string {
  return `${formatIstDate(iso)}, ${formatIstTime(iso)}`;
}

// YYYY-MM-DD in IST, `daysAhead` from now.
export function istDateKey(daysAhead = 0): string {
  return ist(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
}

export function istInstant(date: string, time: string): string {
  return `${date}T${time}:00+05:30`;
}

export const FOOD_RULE_LABEL = { ALLOWED: "Allowed", RESTRICTED: "Restricted", NOT_ALLOWED: "Not allowed" } as const;

export function durationLabel(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
