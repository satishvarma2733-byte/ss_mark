// SYNTHETIC DATA ONLY. These venues, tables, prices and food notes are fictional fixtures for local development.
// They are not real businesses, listings, photos, addresses, amenities or commercial rates.
import type { VenueSummary } from "@simply-sit/contracts";

export const SYNTHETIC_BANNER = "SYNTHETIC DATA - MOCK MODE - NOT A REAL VENUE OR PRICE";

export type SyntheticTable = {
  id: string;
  venueId: string;
  label: string;
  capacity: number;
  pricePerBlockPaise: number;
};

export const SYNTHETIC_VENUES: VenueSummary[] = [
  {
    id: "demo-cafe-koramangala",
    name: "DEMO Cafe Koramangala",
    category: "cafe",
    locality: "Demo locality A (fictional)",
    // "From" is the cheapest table: Table 2 at 12000 per 30 minutes (found by tests/integration/consistency.test.ts).
    tableFromPrice: { amountPaise: 12000, currency: "INR" },
    pricingBasis: "per 30 minutes, one table",
    foodPolicy: { mode: "allowed", note: "Outside food allowed at this table. Ordering from the venue is optional." },
    isSynthetic: true
  },
  {
    id: "demo-lounge-indiranagar",
    name: "DEMO Lounge Indiranagar",
    category: "lounge",
    locality: "Demo locality B (fictional)",
    tableFromPrice: { amountPaise: 22000, currency: "INR" },
    pricingBasis: "per 30 minutes, one table",
    foodPolicy: { mode: "prohibited", note: "Outside food and delivery not permitted. Ordering from the venue is optional." },
    isSynthetic: true
  },
  {
    id: "demo-workspace-hsr",
    name: "DEMO Workspace HSR",
    category: "workspace",
    locality: "Demo locality C (fictional)",
    tableFromPrice: { amountPaise: 12000, currency: "INR" },
    pricingBasis: "per 30 minutes, one table",
    foodPolicy: { mode: "restricted", note: "Cold outside food allowed; no hot food or deliveries to the table. Venue food is optional." },
    isSynthetic: true
  }
];

export const SYNTHETIC_TABLES: SyntheticTable[] = [
  { id: "demo-cafe-koramangala-t1", venueId: "demo-cafe-koramangala", label: "Table 1 (demo)", capacity: 4, pricePerBlockPaise: 15000 },
  { id: "demo-cafe-koramangala-t2", venueId: "demo-cafe-koramangala", label: "Table 2 (demo)", capacity: 2, pricePerBlockPaise: 12000 },
  { id: "demo-lounge-indiranagar-t1", venueId: "demo-lounge-indiranagar", label: "Table 1 (demo)", capacity: 6, pricePerBlockPaise: 22000 },
  { id: "demo-workspace-hsr-t1", venueId: "demo-workspace-hsr", label: "Desk table 1 (demo)", capacity: 3, pricePerBlockPaise: 12000 }
];
