// GET /venues discovery shared by the API route and the web pages. Server-only.
// A manual pilot area or a coarse device location sets the origin; precise coordinates are never logged or stored.
import {
  coarseCoordinate, decodeCursor, encodeCursor, PILOT_AREAS, type VenueSearchQuery, type VenueSearchResult
} from "@simply-sit/contracts";
import { asAnon, DomainError, getDb, searchVenues } from "@simply-sit/db";

export async function runVenueSearch(query: VenueSearchQuery, limit = 20): Promise<VenueSearchResult> {
  const offset = decodeCursor(query.cursor);
  if (offset === "invalid") throw new DomainError("INVALID_CURSOR");
  if ((query.lat === undefined) !== (query.lng === undefined)) throw new DomainError("VALIDATION_FAILED", { field: "lat" });

  const area = query.area ? PILOT_AREAS.find((a) => a.code === query.area) : undefined;
  const origin = area
    ? { label: area.label, lat: area.lat, lng: area.lng, source: "area" as const }
    : query.lat !== undefined && query.lng !== undefined
      ? { label: "Near you", lat: coarseCoordinate(query.lat), lng: coarseCoordinate(query.lng), source: "device" as const }
      : null;
  // A slot needs both its start and its duration; either alone is a field error rather than a silent default.
  if ((query.start_at === undefined) !== (query.duration_minutes === undefined)) {
    throw new DomainError("VALIDATION_FAILED", { field: query.start_at === undefined ? "start_at" : "duration_minutes" });
  }

  const rows = await asAnon(getDb(), (tx) =>
    searchVenues(tx, {
      lat: origin?.lat ?? null,
      lng: origin?.lng ?? null,
      radius_m: query.radius_m ?? null,
      start_at: query.start_at ?? null,
      duration_minutes: query.duration_minutes ?? null,
      party_size: query.party_size ?? null,
      categories: query.category?.length ? query.category : null,
      requirements: query.requirement ? [query.requirement] : null,
      environment: query.environment_tags?.length ? query.environment_tags : null,
      amenities: query.amenities?.length ? query.amenities : null,
      available_only: query.available_only ?? false,
      offset,
      limit
    })
  );
  return {
    venues: rows.venues as VenueSearchResult["venues"],
    total: rows.total,
    next_cursor: rows.next_offset === null ? null : encodeCursor(rows.next_offset),
    searched_at: rows.searched_at,
    area: origin
  };
}
