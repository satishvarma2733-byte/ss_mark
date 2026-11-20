import { describe, expect, it } from "vitest";
import { defaultSize, editableElements, floorProblems, footprint, sameElements, snap, type FloorElement } from "./floor-plan";

const t = (id: string, x: number, y: number, w = 80, h = 80, rotation: 0 | 90 | 180 | 270 = 0): FloorElement =>
  ({ type: "TABLE", resource_id: id, x, y, width: w, height: h, rotation });

describe("floor plan checks (mirror app.layout_problems)", () => {
  it("swaps width and height for quarter turns", () => {
    expect(footprint({ x: 10, y: 20, width: 120, height: 40, rotation: 90 })).toEqual({ x: 10, y: 20, w: 40, h: 120 });
    expect(footprint({ x: 10, y: 20, width: 120, height: 40, rotation: 180 })).toEqual({ x: 10, y: 20, w: 120, h: 40 });
  });

  it("flags overlapping tables, but not fixtures under tables", () => {
    const counter: FloorElement = { type: "COUNTER", x: 0, y: 0, width: 200, height: 60, rotation: 0 };
    expect(floorProblems([counter, t("a", 10, 10)], 400, 300)).toEqual([]);
    expect(floorProblems([t("a", 10, 10), t("b", 60, 60)], 400, 300)).toEqual([{ index: 1, code: "overlaps_table" }]);
    // Touching edges is fine.
    expect(floorProblems([t("a", 0, 0), t("b", 80, 0)], 400, 300)).toEqual([]);
    // A rotated long table reaches into its neighbour.
    expect(floorProblems([t("a", 0, 60, 80, 40), t("b", 0, 0, 120, 40)], 400, 300)).toEqual([]);
    expect(floorProblems([t("a", 0, 60, 80, 40), t("b", 0, 0, 120, 40, 90)], 400, 300)).toEqual([{ index: 1, code: "overlaps_table" }]);
  });

  it("flags items outside the floor and tables placed twice", () => {
    expect(floorProblems([t("a", 350, 10)], 400, 300)).toEqual([{ index: 0, code: "outside_canvas" }]);
    expect(floorProblems([t("a", 0, 0), t("a", 200, 0)], 400, 300)).toEqual([{ index: 1, code: "duplicate_table" }]);
  });

  it("sizes new tables from their seats and shape", () => {
    expect(defaultSize("TABLE", { capacity: 2, shape: "SQUARE" })).toEqual({ width: 60, height: 60 });
    expect(defaultSize("TABLE", { capacity: 6, shape: "RECTANGLE" })).toEqual({ width: 180, height: 70 });
    expect(defaultSize("TABLE", { capacity: 1, shape: "BAR_STOOL" })).toEqual({ width: 40, height: 40 });
    expect(defaultSize("DOOR")).toEqual({ width: 90, height: 24 });
  });

  it("turns a server layout into editable items and compares them", () => {
    const items = editableElements({
      id: "l", layout_version: 1, status: "PUBLISHED", width: 400, height: 300, published_at: null, version: 1,
      elements: [
        { type: "TABLE", resource_id: "a", label: "Desk 1", x: 0, y: 0, width: 80, height: 80, rotation: 0 },
        { type: "DOOR", resource_id: null, label: "Entrance", x: 300, y: 270, width: 90, height: 24, rotation: 0 }
      ]
    });
    expect(items).toEqual([t("a", 0, 0), { type: "DOOR", label: "Entrance", x: 300, y: 270, width: 90, height: 24, rotation: 0 }]);
    expect(sameElements(items, [...items])).toBe(true);
    expect(snap(37, 10)).toBe(40);
  });
});
