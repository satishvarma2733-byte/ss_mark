# Seating zones, floor plans and table pricing - plan

Status: phase 1 (data and API) phase 2 (partner floor editor and prices) phase 3 (native customer seat map) phase 4 (web customer seat map) built 19 November 2026 and phase 5 (busy-hour pricing) built 20 November 2026; see tasks/current/HANDOFF.md. Phase 6 (per-seat booking) needs an owner decision. Concept images (Google Flow, Nano Banana Pro) are in this
folder and are mood references, not final designs; the Figma file stays the design source.

| Image | What it shows |
| --- | --- |
| `01-customer-seat-map.jpg` | Customer picks a zone (Ground floor · Indoor / Outdoor terrace / 1st floor) and a table on a bus-style top-down map with a legend (available, selected, booked, window premium) |
| `02-customer-table-popup.jpg` | Tapping a table opens a sheet: table photo, zone, seats, features, price, date, duration and start-time chips, "Hold this table" |
| `03-owner-floor-editor.jpg` | Partner dine-in setup: zones on the left, drag-and-drop floor canvas (tables, walls, door, counter, window stools), table properties on the right, Preview and Publish |
| `04-owner-pricing.jpg` | Partner pricing: zone base prices, per-table overrides, peak-hour grid, minimum booking and cleaning buffer, customer preview |

## Figma screens (19 November 2026)

Built in the Simply Sit file with the existing components and tokens; these supersede the concept images.

| Screen | Page | Node |
| --- | --- | --- |
| Customer · Choose seating area and table | 06 — Customer Mobile | [2063:220](https://www.figma.com/design/8l7KUOrcpYwh2UpycNdQFC/?node-id=2063-220) |
| Customer · Table details sheet | 06 — Customer Mobile | [2065:270](https://www.figma.com/design/8l7KUOrcpYwh2UpycNdQFC/?node-id=2065-270) |
| C · Partner desktop · Dine-in floor setup | 08 — Partner Dashboard | [2067:1575](https://www.figma.com/design/8l7KUOrcpYwh2UpycNdQFC/?node-id=2067-1575) |
| C · Partner desktop · Area and table pricing | 08 — Partner Dashboard | [2070:1707](https://www.figma.com/design/8l7KUOrcpYwh2UpycNdQFC/?node-id=2070-1707) |
| SS / Seat map table (component set: 2, 4, 6, bar × free, selected, booked, too small) | 05 — Components Library | [2062:102](https://www.figma.com/design/8l7KUOrcpYwh2UpycNdQFC/?node-id=2062-102) |

## What exists today

- `public.resources`: one row per table (label, capacity, status, operational state). No zone, floor, position, shape,
  features or photo.
- `public.resource_rates`: one hourly rate per table, versioned and immutable (no overlapping periods). The server quotes
  from it and snapshots the price on the booking.
- Venue page "From ₹X / hr" is the cheapest table rate. Tables are a plain list with start-time chips.
- Inventory is exclusive per table, enforced in the database. Copy says "one table, not shared".

## Goal

1. Owners describe their real dine-in space: zones (indoor, outdoor, floors, AC, rooftop), tables of any capacity placed
   where they really are, fixtures (walls, door, counter, windows, stairs), table photos and features.
2. Owners set prices by zone, override per table, and (later) add peak-hour adjustments.
3. Customers see that layout like a bus seat map, see which tables are free for their date, time and party, tap one to
   see its photo and price, choose date and time, and hold it through the existing quote → hold → pay flow.

## Data model (new and changed)

All writes are partner-scoped on the server and audited; clients never send a price or availability.

- `venue_zones`: id, venue_id, name ("Ground floor · Indoor"), floor_level (0, 1, ...), kind (INDOOR, OUTDOOR, ROOFTOP,
  PRIVATE_ROOM), features (AC, smoking, quiet, pet-friendly), sort_order, status, optional cover photo (approved media).
- `floor_layouts`: id, zone_id, version, status (DRAFT, PUBLISHED, ARCHIVED), canvas width/height and grid size,
  published_at/by. A published layout is immutable; editing creates a new draft. Only one published layout per zone.
- `layout_elements`: layout_id, type (TABLE or a fixture: WALL, DOOR, COUNTER, WINDOW, STAIRS, PILLAR, PLANT), resource_id
  for tables, x, y, width, height, rotation, shape (ROUND, SQUARE, RECT, BAR_STOOL, SOFA), seat markers count, label.
- `resources` gains: zone_id, shape, features (window, power socket, AC, sofa, accessible), photo media id (reuses the
  photo approval flow), min_party, bookable_online flag.
- Pricing: keep `resource_rates` as the trusted, immutable source the quote reads. The partner UI edits a zone base rate
  plus optional per-table override; saving writes new `resource_rates` versions for the affected tables from a future
  effective time (existing bookings keep their snapshot). Peak rules (`rate_rules`: zone or table, weekdays, time span,
  +/- percent or fixed) come in a later phase; the quote applies them and the price snapshot records which rule applied.
- "From" price on venue cards = cheapest effective rate across bookable tables (unchanged meaning, now zone-aware).

Safety rules that do not change: one booking per table per time (database exclusion constraint), the layout is
presentation only, publishing a layout never moves or cancels a booking, a table with future bookings cannot be retired
or moved to another venue, and each layout publish and price change is audited.

## Customer experience (native app first, then web)

1. Venue page keeps its header; "Select table & time" opens the seat map.
2. Seat map: zone tabs with "from" price per zone, date / duration / party chips, then the floor drawn with
   `react-native-svg` from the published layout. Each table is coloured for the chosen date and duration: available,
   selected, booked or too small for the party, premium (feature-based). Pinch-zoom and pan for large floors.
3. Tap a table: bottom sheet with its photo, zone, seats, features, price per hour and total, date, duration and free
   start times for that table only. "Hold this table" goes into the existing review/quote screen (`book.tsx`).
4. Accessibility: a "List view" toggle shows the same tables as the current list; every table has a spoken label
   ("T4, 4 seats, window, ₹180 per hour, available").
5. Venues without a published layout keep today's list, so nothing breaks during rollout.

## Owner experience (partner portal)

Owner decision on record: partner and staff portals are web. The editor is built in the partner web portal, tablet-first
(landscape iPad/Android tablet in a browser), matching image 03. A native owner app is a separate decision.

1. Zones: add, rename, reorder, set kind, floor and features.
2. Floor editor: grid canvas with snap, drag tables and fixtures from a palette, resize, rotate, duplicate, multi-select,
   undo; templates ("Café 20 seats", "Co-work 12 desks") to start fast. Table panel: label, seats, shape, zone, features,
   photo, bookable online.
3. Pricing (image 04): zone base price, per-table overrides, effective-from date; later peak-hour grid.
4. Preview as customer, then Publish. Validation before publish: labels unique, no overlapping tables, every table has
   a price, capacities 1-50.

## Phases

1. Data and API: zones, layout versions and elements, new resource fields, zone pricing writing `resource_rates`,
   availability API returning per-table state for a date/time/duration, contracts and integration tests. Seed one demo
   venue with three zones.
2. Partner editor and pricing screens (web, tablet-first), with publish validation and audit.
3. Customer seat map and table sheet on mobile (Android + iOS), with list fallback.
4. Customer seat map on web.
5. Peak-hour pricing rules in the quote and price snapshot.
6. Later, only if approved: per-seat booking of communal tables.

## Decisions needed from the owner

1. Communal tables by the seat (image 01 shows seats of L1 booked separately). This breaks "one table, not shared" and
   the per-table exclusive inventory. Recommendation: not in the first release; book whole tables only.
2. Owner editor on web (tablet browser) as recorded, or a native owner app. Recommendation: web first.
3. Peak-hour pricing in the first release or later. Recommendation: later (phase 5); zone and table prices first.
4. Customer order: pick time first then table (current), or table first then time. Recommendation: map shows
   availability for the chosen date and duration; the sheet then picks the start time - both orders work.

## Testing

Unit tests for layout validation and price resolution; integration tests for publish, price versioning, concurrent holds
on the same table from the map, and retiring a table with future bookings; e2e for owner publish → customer map → hold →
pay; emulator checks for the native map (zoom, tap targets, list fallback, screen reader labels).
