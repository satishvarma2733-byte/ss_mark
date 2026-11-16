// Server-side venue reads from PostgreSQL under the anon role, so RLS decides what is public (published venues only).
import type { VenueSummary } from "@simply-sit/contracts";
import { asAnon, getDb, getPublishedVenueBySlug, listPublishedVenues } from "@simply-sit/db";

const FOOD_MODE = { ALLOWED: "allowed", RESTRICTED: "restricted", NOT_ALLOWED: "prohibited" } as const;

// The M1 listing contract (camelCase, per-30-minute basis) is kept until M3.1 replaces discovery with docs/07 GET /venues.
// It can only describe synthetic listings, so only synthetic-flagged rows are mapped.
export async function listVenues(): Promise<VenueSummary[]> {
  const rows = await asAnon(getDb(), (tx) => listPublishedVenues(tx));
  return rows
    .filter((row) => row.is_synthetic && row.from_hourly_paise !== null)
    .map((row) => ({
      id: row.slug,
      name: row.name,
      category: row.category_code.toLowerCase() as VenueSummary["category"],
      locality: row.locality,
      tableFromPrice: { amountPaise: Math.floor((row.from_hourly_paise! + 1) / 2), currency: "INR" as const },
      pricingBasis: "per 30 minutes, one table" as const,
      foodPolicy: { mode: FOOD_MODE[row.byo_food], note: row.byo_details.slice(0, 280) },
      isSynthetic: true as const
    }));
}

export async function getVenue(slug: string) {
  return asAnon(getDb(), (tx) => getPublishedVenueBySlug(tx, slug));
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const FOOD_LABEL = { ALLOWED: "Allowed", RESTRICTED: "Restricted", NOT_ALLOWED: "Not allowed" } as const;
