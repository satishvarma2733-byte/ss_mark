// Seating areas, floor layouts and area prices (seat-map phase 1). Thin wrappers: every rule (membership, TOTP,
// validation, immutability of published layouts, audit) lives in the app.* SECURITY DEFINER functions.
import type postgres from "postgres";

type Tx = postgres.TransactionSql;
type Json = Record<string, unknown>;

async function callJson<T = Json>(query: postgres.PendingQuery<postgres.Row[]>): Promise<T> {
  const rows = await query;
  return rows[0]?.result as T;
}

export function partnerSeating(tx: Tx, venueId: string) {
  return callJson(tx`select app.partner_seating(${venueId}::uuid) as result`);
}

export function partnerCreateZone(
  tx: Tx,
  venueId: string,
  input: { name: string; kind?: string | undefined; floor_level?: number | undefined; features?: string[] | undefined },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.partner_create_zone(${venueId}::uuid, ${input.name}, ${input.kind ?? null}, ${input.floor_level ?? null}::integer,
                                   ${input.features ?? null}::text[], ${requestId}::uuid) as result`);
}

export function partnerUpdateZone(
  tx: Tx,
  zoneId: string,
  input: {
    name?: string | undefined; kind?: string | undefined; floor_level?: number | undefined; features?: string[] | undefined;
    sort_order?: number | undefined; expected_version: number;
  },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.partner_update_zone(${zoneId}::uuid, ${input.name ?? null}, ${input.kind ?? null}, ${input.floor_level ?? null}::integer,
                                   ${input.features ?? null}::text[], ${input.sort_order ?? null}::integer,
                                   ${input.expected_version}::integer, ${requestId}::uuid) as result`);
}

export function partnerArchiveZone(tx: Tx, zoneId: string, expectedVersion: number, requestId: string | null = null) {
  return callJson(tx`select app.partner_archive_zone(${zoneId}::uuid, ${expectedVersion}::integer, ${requestId}::uuid) as result`);
}

export function partnerSetTableDetails(
  tx: Tx,
  resourceId: string,
  input: {
    zone_id?: string | null | undefined; shape?: string | undefined; features?: string[] | undefined;
    photo_media_id?: string | null | undefined; expected_version: number;
  },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.partner_set_table_details(${resourceId}::uuid, ${input.zone_id ?? null}::uuid, ${input.zone_id === null}::boolean,
                                         ${input.shape ?? null}, ${input.features ?? null}::text[], ${input.photo_media_id ?? null}::uuid,
                                         ${input.photo_media_id === null}::boolean, ${input.expected_version}::integer,
                                         ${requestId}::uuid) as result`);
}

export function partnerSaveLayoutDraft(
  tx: Tx,
  zoneId: string,
  input: { width: number; height: number; elements: Json[]; expected_version: number | null },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.partner_save_layout_draft(${zoneId}::uuid, ${input.width}::integer, ${input.height}::integer,
                                         ${tx.json(input.elements as postgres.JSONValue)}, ${input.expected_version}::integer,
                                         ${requestId}::uuid) as result`);
}

export function partnerPublishLayout(tx: Tx, zoneId: string, expectedVersion: number, requestId: string | null = null) {
  return callJson(tx`select app.partner_publish_layout(${zoneId}::uuid, ${expectedVersion}::integer, ${requestId}::uuid) as result`);
}

export function partnerSetZonePrice(
  tx: Tx,
  zoneId: string,
  input: { hourly_paise: number; effective_from?: string | undefined; keep_custom_prices: boolean; expected_version: number },
  requestId: string | null = null
) {
  return callJson(tx`
    select app.partner_set_zone_price(${zoneId}::uuid, ${input.hourly_paise}::bigint, ${input.effective_from ?? null}::text::timestamptz,
                                      ${input.keep_custom_prices}::boolean, ${input.expected_version}::integer,
                                      ${requestId}::uuid) as result`);
}

// Public (anon or authenticated; published venues only).
export function venueSeating(tx: Tx, venueId: string) {
  return callJson(tx`select app.venue_seating(${venueId}::uuid) as result`);
}

export function venueSeatMap(tx: Tx, venueId: string, startAt: string, durationMinutes: number, partySize: number) {
  return callJson<Json & { tables: Json[] }>(tx`
    select app.venue_seat_map(${venueId}::uuid, ${startAt}::timestamptz, ${durationMinutes}::integer, ${partySize}::integer) as result`);
}
