// Floor-plan editor model (seat-map phase 2). Types mirror app.partner_seating; the checks mirror app.layout_problems so
// the editor can flag overlaps and out-of-bounds items before saving. The server re-checks everything on save and
// publish; this file only gives earlier feedback.
export type ElementType = "TABLE" | "WALL" | "DOOR" | "WINDOW" | "COUNTER" | "STAIRS" | "PILLAR" | "PLANT" | "LABEL";
export type Rotation = 0 | 90 | 180 | 270;

export type FloorElement = {
  type: ElementType;
  resource_id?: string;
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: Rotation;
};

export type Layout = {
  id: string;
  layout_version: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  width: number;
  height: number;
  published_at: string | null;
  version: number;
  elements: (Omit<FloorElement, "resource_id" | "label"> & { resource_id: string | null; label: string | null })[];
};

export type Zone = {
  id: string;
  name: string;
  kind: "INDOOR" | "OUTDOOR" | "ROOFTOP" | "PRIVATE_ROOM";
  floor_level: number;
  features: string[];
  default_hourly_paise: number | null;
  sort_order: number;
  status: string;
  version: number;
  published_layout: Layout | null;
  draft_layout: Layout | null;
};

export type SeatingTable = {
  id: string;
  label: string;
  capacity: number;
  status: "ACTIVE" | "PAUSED" | "RETIRED";
  zone_id: string | null;
  shape: "ROUND" | "SQUARE" | "RECTANGLE" | "BAR_STOOL" | "SOFA";
  features: string[];
  photo_media_id: string | null;
  hourly_paise: number | null;
  version: number;
};

export type RateRule = {
  id: string; zone_id: string | null; label: string; weekdays: number[]; starts_local: string; ends_local: string; adjustment_bps: number;
  status: "ACTIVE" | "ARCHIVED"; created_at: string;
};
export type PartnerSeating = { venue_id: string; zones: Zone[]; tables: SeatingTable[]; rate_rules?: RateRule[] };

export const ZONE_KIND_LABEL: Record<Zone["kind"], string> = {
  INDOOR: "Indoor", OUTDOOR: "Outdoor", ROOFTOP: "Rooftop", PRIVATE_ROOM: "Private room"
};
export const ZONE_FEATURE_LABEL: Record<string, string> = {
  AIR_CONDITIONED: "Air-conditioned", COVERED: "Covered", QUIET: "Quiet", SMOKING_ALLOWED: "Smoking allowed",
  PET_FRIENDLY: "Pet friendly", STEP_FREE: "Step-free"
};
export const TABLE_FEATURE_LABEL: Record<string, string> = {
  WINDOW: "Window view", POWER_SOCKET: "Power socket", AIR_CONDITIONED: "Air-conditioned", SOFA_SEATING: "Sofa seating",
  STEP_FREE: "Step-free", QUIET: "Quiet corner", VIEW: "Nice view"
};
export const SHAPE_LABEL: Record<SeatingTable["shape"], string> = {
  ROUND: "Round", SQUARE: "Square", RECTANGLE: "Long", BAR_STOOL: "Bar stool", SOFA: "Sofa"
};
export const FIXTURE_LABEL: Record<Exclude<ElementType, "TABLE">, string> = {
  WALL: "Wall", DOOR: "Door", WINDOW: "Window", COUNTER: "Counter", STAIRS: "Stairs", PILLAR: "Pillar", PLANT: "Plant", LABEL: "Text label"
};

// Default footprint for a new item, in canvas units (1 unit = 1 px at 100%).
export function defaultSize(type: ElementType, table?: Pick<SeatingTable, "capacity" | "shape">): { width: number; height: number } {
  if (type === "TABLE" && table) {
    if (table.shape === "BAR_STOOL") return { width: 40, height: 40 };
    if (table.shape === "SOFA") return { width: 140, height: 60 };
    if (table.shape === "RECTANGLE" || table.capacity >= 6) return { width: Math.min(60 + table.capacity * 20, 300), height: 70 };
    if (table.capacity <= 2) return { width: 60, height: 60 };
    return { width: 80, height: 80 };
  }
  const sizes: Record<Exclude<ElementType, "TABLE">, { width: number; height: number }> = {
    WALL: { width: 200, height: 8 }, DOOR: { width: 90, height: 24 }, WINDOW: { width: 160, height: 8 },
    COUNTER: { width: 180, height: 60 }, STAIRS: { width: 90, height: 90 }, PILLAR: { width: 30, height: 30 },
    PLANT: { width: 36, height: 36 }, LABEL: { width: 120, height: 30 }
  };
  return sizes[type as Exclude<ElementType, "TABLE">];
}

// The box an element occupies: 90/270 degree rotation swaps width and height (same rule as the server).
export function footprint(e: Pick<FloorElement, "x" | "y" | "width" | "height" | "rotation">) {
  const turned = e.rotation === 90 || e.rotation === 270;
  return { x: e.x, y: e.y, w: turned ? e.height : e.width, h: turned ? e.width : e.height };
}

export type Problem = { index: number; code: "outside_canvas" | "overlaps_table" | "duplicate_table" | "too_small" };

export function floorProblems(elements: FloorElement[], width: number, height: number): Problem[] {
  const problems: Problem[] = [];
  const seen = new Set<string>();
  const tables: { x: number; y: number; w: number; h: number }[] = [];
  elements.forEach((e, index) => {
    const box = footprint(e);
    if (e.width < 4 || e.height < 4) problems.push({ index, code: "too_small" });
    if (box.x < 0 || box.y < 0 || box.x + box.w > width || box.y + box.h > height) problems.push({ index, code: "outside_canvas" });
    if (e.type !== "TABLE" || !e.resource_id) return;
    if (seen.has(e.resource_id)) {
      problems.push({ index, code: "duplicate_table" });
      return;
    }
    seen.add(e.resource_id);
    if (tables.some((b) => box.x < b.x + b.w && b.x < box.x + box.w && box.y < b.y + b.h && b.y < box.y + box.h)) {
      problems.push({ index, code: "overlaps_table" });
    }
    tables.push(box);
  });
  return problems;
}

export const PROBLEM_TEXT: Record<string, string> = {
  outside_canvas: "sticks out of the floor",
  overlaps_table: "overlaps another table",
  duplicate_table: "is on the floor twice",
  too_small: "is too small",
  table_in_other_area: "belongs to another area",
  table_retired: "has been retired",
  unknown_table: "is not one of your tables",
  geometry: "has an invalid size or position",
  label: "has a label that is too long",
  type: "is not a known item"
};

export const snap = (value: number, grid: number) => Math.round(value / grid) * grid;
export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

// Server layout -> editable elements (labels of tables come from the table itself, so they are not stored).
export function editableElements(layout: Layout | null): FloorElement[] {
  return (layout?.elements ?? []).map((e) => ({
    type: e.type,
    ...(e.resource_id ? { resource_id: e.resource_id } : {}),
    ...(e.type !== "TABLE" && e.label ? { label: e.label } : {}),
    x: e.x, y: e.y, width: e.width, height: e.height, rotation: (e.rotation as Rotation) ?? 0
  }));
}

export function sameElements(a: FloorElement[], b: FloorElement[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
