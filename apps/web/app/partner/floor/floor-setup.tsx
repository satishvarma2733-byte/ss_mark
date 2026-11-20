"use client";

// Seat-map phase 2 - Figma "C · Partner desktop · Dine-in floor setup" (2067:1575). Left: areas and the items to add.
// Middle: the floor drawing (drag to move, arrow keys nudge, R rotates, Delete removes). Right: the selected table's or
// item's settings. Bottom: save, preview and publish. Every rule is re-checked by the server (app.partner_* functions).
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { CheckCircle2, CopyPlus, Eye, Grid3x3, Info, Plus, RotateCw, Trash2, TriangleAlert } from "lucide-react";
import {
  clamp, defaultSize, editableElements, FIXTURE_LABEL, floorProblems, footprint, PROBLEM_TEXT, sameElements, SHAPE_LABEL, snap,
  TABLE_FEATURE_LABEL, ZONE_FEATURE_LABEL, ZONE_KIND_LABEL, type ElementType, type FloorElement, type Layout, type PartnerSeating,
  type Rotation, type SeatingTable, type Zone
} from "../../../lib/floor-plan";
import { formatInrPaise } from "../../../lib/format";
import { useAction } from "../../../lib/use-action";
import { Button, Card } from "../../../components/ui";
import { Status } from "../inventory/inventory-editor";

type Photo = { id: string; alt_text: string };
const GRID = 10;
const NEW_FLOOR = { width: 600, height: 400 };
const FIXTURES = Object.keys(FIXTURE_LABEL) as Exclude<ElementType, "TABLE">[];

export function FloorSetup({ seating, photos, initialZoneId, venueId }: { seating: PartnerSeating; photos: Photo[]; initialZoneId?: string | undefined; venueId: string }) {
  const [zoneId, setZoneId] = useState(seating.zones.find((z) => z.id === initialZoneId)?.id ?? seating.zones[0]?.id ?? null);
  const zone = seating.zones.find((z) => z.id === zoneId) ?? null;
  return (
    <div className="floor-setup" data-testid="floor-setup">
      <AreasPanel seating={seating} zoneId={zoneId} onSelect={setZoneId} venueId={venueId} />
      {zone ? (
        // One editor per area. After a save or publish the refreshed drawing equals the edited one, so it is no longer "dirty".
        <ZoneEditor key={zone.id} zone={zone} tables={seating.tables} photos={photos} />
      ) : (
        <Card className="book-card floor-empty">
          <h2>Start with an area</h2>
          <p className="book-when">Add your first area on the left, for example “Ground floor”, “Terrace” or “1st floor”. Then place its tables.</p>
        </Card>
      )}
    </div>
  );
}

function AreasPanel({ seating, zoneId, onSelect, venueId }: { seating: PartnerSeating; zoneId: string | null; onSelect: (id: string) => void; venueId: string }) {
  const action = useAction();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Zone["kind"]>("INDOOR");
  const [floor, setFloor] = useState("0");
  const current = seating.zones.find((z) => z.id === zoneId) ?? null;
  return (
    <div className="floor-left">
      <Card className="book-card" aria-labelledby="areas-heading">
        <h2 id="areas-heading">Areas</h2>
        <p className="field-hint">Each area can have its own price and floor drawing.</p>
        <ul className="area-list" data-testid="area-list">
          {seating.zones.map((z) => {
            const count = seating.tables.filter((t) => t.zone_id === z.id).length;
            return (
              <li key={z.id}>
                <button type="button" className="area-row" aria-current={z.id === zoneId ? "true" : undefined} onClick={() => onSelect(z.id)}>
                  <strong>{z.name}</strong>
                  <span>
                    {ZONE_KIND_LABEL[z.kind]} · {count} {count === 1 ? "table" : "tables"}
                    {z.published_layout ? " · published" : z.draft_layout ? " · draft" : " · no drawing yet"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <form className="area-add" onSubmit={(e) => {
          e.preventDefault();
          void action.run("add-area", "POST", `/api/v1/partner/venues/${venueId}/zones`, { name, kind, floor_level: Number(floor) },
            { idempotent: true, success: `Added “${name}”.` }).then((r) => { if (r.ok) { setName(""); onSelect((r.data as { id: string }).id); } });
        }}>
          <label className="field-label" htmlFor="area-name">New area</label>
          <input id="area-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Terrace" required maxLength={60} />
          <div className="field-pair">
            <select aria-label="Area type" className="input" value={kind} onChange={(e) => setKind(e.target.value as Zone["kind"])}>
              {Object.entries(ZONE_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select aria-label="Floor" className="input" value={floor} onChange={(e) => setFloor(e.target.value)}>
              <option value="-1">Basement</option>
              <option value="0">Ground floor</option>
              <option value="1">1st floor</option>
              <option value="2">2nd floor</option>
              <option value="3">3rd floor</option>
            </select>
          </div>
          <Button variant="secondary" type="submit" block loading={action.busy === "add-area"} leftIcon={<Plus size={16} aria-hidden="true" />}>
            Add area
          </Button>
        </form>
        <Status message={action.message} />
      </Card>
      {current ? <AreaSettings key={current.id} zone={current} /> : null}
    </div>
  );
}

function AreaSettings({ zone }: { zone: Zone }) {
  const action = useAction();
  const [name, setName] = useState(zone.name);
  const [kind, setKind] = useState(zone.kind);
  const [features, setFeatures] = useState(new Set(zone.features));
  return (
    <form className="card book-card" aria-labelledby="area-settings-heading" onSubmit={(e) => {
      e.preventDefault();
      void action.run("area", "PATCH", `/api/v1/partner/zones/${zone.id}`, { name, kind, features: [...features], expected_version: zone.version },
        { success: "Area saved." });
    }}>
      <h2 id="area-settings-heading">Area details</h2>
      <div className="field">
        <label className="field-label" htmlFor="area-edit-name">Name guests see</label>
        <input id="area-edit-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="area-edit-kind">Type</label>
        <select id="area-edit-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as Zone["kind"])}>
          {Object.entries(ZONE_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <fieldset className="chip-checks">
        <legend className="field-label">What this area offers</legend>
        {Object.entries(ZONE_FEATURE_LABEL).map(([code, label]) => (
          <label key={code} className={`choice-pill${features.has(code) ? " selected" : ""}`}>
            <input type="checkbox" checked={features.has(code)} onChange={(e) => {
              const next = new Set(features);
              if (e.target.checked) next.add(code); else next.delete(code);
              setFeatures(next);
            }} />
            {label}
          </label>
        ))}
      </fieldset>
      <Button variant="secondary" type="submit" loading={action.busy === "area"}>Save area</Button>
      <Status message={action.message} />
    </form>
  );
}

// First free spot on a grid for a new table (no overlap with other tables), else the top-left corner.
function freeSpot(elements: FloorElement[], size: { width: number; height: number }, floor: { width: number; height: number }) {
  for (let y = 20; y + size.height <= floor.height - 10; y += 20) {
    for (let x = 20; x + size.width <= floor.width - 10; x += 20) {
      const box = { x, y, w: size.width, h: size.height };
      const clash = elements.some((e) => {
        const b = footprint(e);
        return box.x < b.x + b.w + 10 && b.x < box.x + box.w + 10 && box.y < b.y + b.h + 10 && b.y < box.y + box.h + 10;
      });
      if (!clash) return { x, y };
    }
  }
  return { x: 10, y: 10 };
}

function ZoneEditor({ zone, tables, photos }: { zone: Zone; tables: SeatingTable[]; photos: Photo[] }) {
  const action = useAction();
  const source: Layout | null = zone.draft_layout ?? zone.published_layout;
  const initial = useMemo(() => editableElements(source), [source]);
  const [elements, setElements] = useState<FloorElement[]>(initial);
  const [floor, setFloor] = useState({ width: source?.width ?? NEW_FLOOR.width, height: source?.height ?? NEW_FLOOR.height });
  const [selected, setSelected] = useState<number | null>(null);
  const [snapOn, setSnapOn] = useState(true);
  const [preview, setPreview] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ index: number; dx: number; dy: number } | null>(null);

  const byId = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables]);
  const areaTables = tables.filter((t) => t.zone_id === zone.id);
  const placed = new Set(elements.filter((e) => e.resource_id).map((e) => e.resource_id!));
  const unplaced = areaTables.filter((t) => !placed.has(t.id));
  const unzoned = tables.filter((t) => t.zone_id === null);
  const problems = floorProblems(elements, floor.width, floor.height);
  const serverProblems = Array.isArray(action.details?.problems) ? (action.details.problems as { index?: number; code: string; label?: string }[]) : [];
  const bad = new Set([...problems.map((p) => p.index), ...serverProblems.map((p) => p.index ?? -1)]);
  const dirty = !sameElements(elements, initial) || floor.width !== (source?.width ?? NEW_FLOOR.width) || floor.height !== (source?.height ?? NEW_FLOOR.height);
  const tableCount = elements.filter((e) => e.type === "TABLE").length;
  const seats = elements.reduce((sum, e) => sum + (e.resource_id ? byId.get(e.resource_id)?.capacity ?? 0 : 0), 0);
  const nameOf = (e: FloorElement) => (e.resource_id ? byId.get(e.resource_id)?.label ?? "Table" : e.label || FIXTURE_LABEL[e.type as Exclude<ElementType, "TABLE">]);
  const sel = selected !== null ? elements[selected] ?? null : null;

  const update = (index: number, patch: Partial<FloorElement>) => setElements((all) => all.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  const add = (type: ElementType, table?: SeatingTable) => {
    const size = defaultSize(type, table);
    const at = freeSpot(elements, size, floor);
    const el: FloorElement = { type, ...(table ? { resource_id: table.id } : {}), ...(type === "LABEL" ? { label: "Label" } : {}), ...at, ...size, rotation: 0 };
    setElements((all) => [...all, el]);
    setSelected(elements.length);
  };
  const remove = (index: number) => { setElements((all) => all.filter((_, i) => i !== index)); setSelected(null); };
  const rotate = (index: number) => {
    const e = elements[index]!;
    update(index, { rotation: (((e.rotation + 90) % 360) as Rotation) });
  };
  const duplicate = (index: number) => {
    const e = elements[index]!;
    if (e.type === "TABLE") return;
    setElements((all) => [...all, { ...e, x: clamp(e.x + 20, 0, floor.width - 4), y: clamp(e.y + 20, 0, floor.height - 4) }]);
    setSelected(elements.length);
  };

  const toFloor = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const onPointerDown = (index: number) => (ev: PointerEvent<SVGGElement>) => {
    if (preview) return;
    ev.preventDefault();
    const p = toFloor(ev.clientX, ev.clientY);
    const e = elements[index]!;
    drag.current = { index, dx: p.x - e.x, dy: p.y - e.y };
    setSelected(index);
    svgRef.current?.setPointerCapture(ev.pointerId);
  };
  const onPointerMove = (ev: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toFloor(ev.clientX, ev.clientY);
    const e = elements[d.index]!;
    const box = footprint(e);
    const g = snapOn ? GRID : 1;
    update(d.index, { x: clamp(snap(p.x - d.dx, g), 0, floor.width - box.w), y: clamp(snap(p.y - d.dy, g), 0, floor.height - box.h) });
  };
  const endDrag = (ev: PointerEvent<SVGSVGElement>) => {
    drag.current = null;
    if (svgRef.current?.hasPointerCapture(ev.pointerId)) svgRef.current.releasePointerCapture(ev.pointerId);
  };
  const onKey = (index: number) => (ev: KeyboardEvent<SVGGElement>) => {
    const step = ev.shiftKey ? 1 : GRID;
    const e = elements[index]!;
    const box = footprint(e);
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[ev.key]) {
      ev.preventDefault();
      const [mx, my] = moves[ev.key]!;
      update(index, { x: clamp(e.x + mx, 0, floor.width - box.w), y: clamp(e.y + my, 0, floor.height - box.h) });
    } else if (ev.key === "r" || ev.key === "R") {
      ev.preventDefault();
      rotate(index);
    } else if (ev.key === "Delete" || ev.key === "Backspace") {
      ev.preventDefault();
      remove(index);
    } else if (ev.key === "Escape") {
      setSelected(null);
    }
  };

  const draftBody = (expected: number | null) => ({
    width: floor.width, height: floor.height, expected_version: expected,
    elements: elements.map((e) => ({
      type: e.type, ...(e.resource_id ? { resource_id: e.resource_id } : {}), ...(e.type !== "TABLE" && e.label ? { label: e.label } : {}),
      x: Math.round(e.x), y: Math.round(e.y), width: Math.round(e.width), height: Math.round(e.height), rotation: e.rotation
    }))
  });
  const saveDraft = () => action.run<Layout>("save", "PUT", `/api/v1/partner/zones/${zone.id}/layout-draft`, draftBody(zone.draft_layout?.version ?? null),
    { success: "Draft saved. Guests still see the published floor." });
  const publish = async () => {
    let version = zone.draft_layout?.version ?? null;
    if (dirty || version === null) {
      const saved = await action.run<Layout>("publish", "PUT", `/api/v1/partner/zones/${zone.id}/layout-draft`, draftBody(version), { refresh: false });
      if (!saved.ok) return;
      version = saved.data.version;
    }
    await action.run("publish", "POST", `/api/v1/partner/zones/${zone.id}/publish-layout`, { expected_version: version },
      { success: `Published. Guests now see this floor for ${zone.name}. Existing bookings are unchanged.` });
  };

  const status = dirty ? "Unsaved changes" : zone.draft_layout ? `Draft v${zone.draft_layout.layout_version} saved · not published yet`
    : zone.published_layout ? `Published v${zone.published_layout.layout_version} · what guests see now` : "No drawing yet";
  const readyText = problems.length > 0 ? `${problems.length} ${problems.length === 1 ? "thing needs" : "things need"} fixing before you can save.`
    : tableCount === 0 ? "Place at least one table to publish."
    : `${tableCount} ${tableCount === 1 ? "table" : "tables"} · ${seats} seats · no overlaps. Publishing never moves an existing booking.`;

  return (
    <div className="zone-editor">
      <div className="floor-center">
        <div className="floor-toolbar" role="toolbar" aria-label="Floor tools">
          <strong>{zone.name}</strong>
          <span className="floor-toolbar-spacer" />
          <Button variant="ghost" size="sm" disabled={sel === null || preview} onClick={() => selected !== null && rotate(selected)} leftIcon={<RotateCw size={16} aria-hidden="true" />}>Rotate</Button>
          <Button variant="ghost" size="sm" disabled={sel === null || sel.type === "TABLE" || preview} onClick={() => selected !== null && duplicate(selected)} leftIcon={<CopyPlus size={16} aria-hidden="true" />}>Duplicate</Button>
          <Button variant="ghost" size="sm" disabled={sel === null || preview} onClick={() => selected !== null && remove(selected)} leftIcon={<Trash2 size={16} aria-hidden="true" />}>Remove</Button>
          <label className="floor-snap">
            <input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} />
            <Grid3x3 size={16} aria-hidden="true" /> Snap to grid
          </label>
        </div>
        <div className={`floor-canvas${preview ? " preview" : ""}`}>
          <svg ref={svgRef} viewBox={`0 0 ${floor.width} ${floor.height}`} role="application" data-testid="floor-canvas"
            aria-label={`Floor drawing for ${zone.name}: ${tableCount} tables. Select an item, then use the arrow keys to move it, R to rotate, Delete to remove.`}
            onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
            onPointerDown={(ev) => { if (ev.target === svgRef.current || (ev.target as Element).classList.contains("floor-bg")) setSelected(null); }}>
            <defs>
              <pattern id="floor-grid" width={20} height={20} patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" className="floor-grid-line" />
              </pattern>
            </defs>
            <rect className="floor-bg" x={0} y={0} width={floor.width} height={floor.height} fill={preview ? "var(--surface-canvas)" : "url(#floor-grid)"} />
            {elements.map((e, i) => (
              <FloorItem key={i} e={e} table={e.resource_id ? byId.get(e.resource_id) : undefined} selected={i === selected && !preview}
                problem={bad.has(i)} preview={preview} name={nameOf(e)} onPointerDown={onPointerDown(i)} onKeyDown={onKey(i)} onFocus={() => setSelected(i)} />
            ))}
          </svg>
        </div>
        <p className="field-hint">
          {preview ? "Preview: guests will see free, booked and too-small tables in colour for the time they choose."
            : "Drag items to move them. With an item selected: arrow keys nudge (Shift for 1 px), R rotates, Delete removes."}
        </p>
      </div>

      <div className="floor-right">
        <Card className="book-card" aria-labelledby="add-heading">
          <h2 id="add-heading">Add to the floor</h2>
          <p className="field-hint">Your tables in this area:</p>
          {unplaced.length > 0 ? (
            <div className="choice-pills" data-testid="unplaced-tables">
              {unplaced.map((t) => (
                <button key={t.id} type="button" className="choice-pill" disabled={preview} onClick={() => add("TABLE", t)}>
                  <Plus size={14} aria-hidden="true" /> {t.label} · {t.capacity} {t.capacity === 1 ? "seat" : "seats"}
                </button>
              ))}
            </div>
          ) : (
            <p className="book-when">{areaTables.length === 0 ? "No tables in this area yet." : "Every table in this area is on the floor."}</p>
          )}
          {unzoned.length > 0 ? <MoveIntoArea zone={zone} tables={unzoned} /> : null}
          <p className="field-hint">Room items:</p>
          <div className="fixture-grid">
            {FIXTURES.map((type) => (
              <button key={type} type="button" className="fixture-tile" disabled={preview} onClick={() => add(type)}>
                <span className={`fixture-swatch fx-${type.toLowerCase()}`} aria-hidden="true" />
                {FIXTURE_LABEL[type]}
              </button>
            ))}
          </div>
        </Card>
        {sel && selected !== null ? (
          sel.type === "TABLE" && sel.resource_id && byId.get(sel.resource_id) ? (
            <TablePanel key={sel.resource_id} table={byId.get(sel.resource_id)!} e={sel} photos={photos} floor={floor}
              onChange={(p) => update(selected, p)} />
          ) : (
            <ItemPanel e={sel} floor={floor} onChange={(p) => update(selected, p)} />
          )
        ) : (
          <Card className="book-card" aria-labelledby="floor-size-heading">
            <h2 id="floor-size-heading">Floor size</h2>
            <p className="field-hint">The drawing is to your own scale; 100 units is roughly a large table.</p>
            <div className="field-pair">
              <NumberField label="Width" value={floor.width} min={200} max={4000} onChange={(width) => setFloor({ ...floor, width })} />
              <NumberField label="Depth" value={floor.height} min={200} max={4000} onChange={(height) => setFloor({ ...floor, height })} />
            </div>
          </Card>
        )}
      </div>

      <div className="floor-publish card" data-testid="publish-bar">
        <div className="floor-publish-state">
          {problems.length === 0 && tableCount > 0 ? <CheckCircle2 size={22} className="ok" aria-hidden="true" /> : <TriangleAlert size={22} className="warn" aria-hidden="true" />}
          <div>
            <strong>{status}</strong>
            <p>{readyText}</p>
            {problems.length > 0 || serverProblems.length > 0 ? (
              <ul className="plain-list" data-testid="floor-problems">
                {problems.map((p, i) => <li key={`c${i}`}>{nameOf(elements[p.index]!)} {PROBLEM_TEXT[p.code]}</li>)}
                {serverProblems.map((p, i) => (
                  <li key={`s${i}`}>{p.label ?? (p.index !== undefined && elements[p.index] ? nameOf(elements[p.index]!) : "An item")} {PROBLEM_TEXT[p.code] ?? p.code.replace(/_/g, " ")}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <div className="floor-publish-actions">
          {dirty ? <Button variant="ghost" onClick={() => { setElements(initial); setSelected(null); action.clear(); }}>Discard changes</Button> : null}
          <Button variant="ghost" onClick={() => void saveDraft()} loading={action.busy === "save"} disabled={!dirty || problems.length > 0 || action.busy !== null}>Save draft</Button>
          <Button variant="secondary" onClick={() => { setPreview(!preview); setSelected(null); }} leftIcon={<Eye size={16} aria-hidden="true" />} aria-pressed={preview}>
            {preview ? "Back to editing" : "Preview as guest"}
          </Button>
          <Button onClick={() => void publish()} loading={action.busy === "publish"} data-testid="publish-floor"
            disabled={problems.length > 0 || tableCount === 0 || action.busy !== null || (!dirty && !zone.draft_layout)}>
            Publish floor
          </Button>
        </div>
        <Status message={action.message} />
      </div>
    </div>
  );
}

function FloorItem({ e, table, selected, problem, preview, name, onPointerDown, onKeyDown, onFocus }: {
  e: FloorElement; table: SeatingTable | undefined; selected: boolean; problem: boolean; preview: boolean; name: string;
  onPointerDown: (ev: PointerEvent<SVGGElement>) => void; onKeyDown: (ev: KeyboardEvent<SVGGElement>) => void; onFocus: () => void;
}) {
  const b = footprint(e);
  const isTable = e.type === "TABLE";
  const round = table?.shape === "ROUND" || table?.shape === "BAR_STOOL" || e.type === "PLANT" || e.type === "PILLAR";
  const rx = round ? Math.min(b.w, b.h) / 2 : isTable ? 10 : e.type === "WALL" || e.type === "WINDOW" ? 2 : 6;
  const cls = ["floor-item", `fx-${e.type.toLowerCase()}`, selected ? "selected" : "", problem ? "problem" : "", table && table.status !== "ACTIVE" ? "paused" : ""].filter(Boolean).join(" ");
  const showText = isTable || ["DOOR", "COUNTER", "STAIRS", "LABEL"].includes(e.type);
  return (
    <g className={cls} transform={`translate(${b.x} ${b.y})`} onPointerDown={onPointerDown} onKeyDown={onKeyDown} onFocus={onFocus}
      tabIndex={preview ? -1 : 0} role="button" aria-pressed={selected}
      aria-label={isTable && table ? `${name}, ${table.capacity} seats${problem ? ", needs fixing" : ""}` : `${name}${problem ? ", needs fixing" : ""}`}>
      <rect width={b.w} height={b.h} rx={rx} />
      {showText ? (
        <text x={b.w / 2} y={isTable && b.h >= 44 ? b.h / 2 - 3 : b.h / 2 + 4} textAnchor="middle">
          {isTable ? table?.label.replace(/^(Table|Desk)\s+/i, "") ?? "?" : name}
        </text>
      ) : null}
      {isTable && table && b.h >= 44 ? <text className="seats" x={b.w / 2} y={b.h / 2 + 13} textAnchor="middle">{table.capacity} seats</text> : null}
      {selected ? <rect className="selection" x={-5} y={-5} width={b.w + 10} height={b.h + 10} rx={rx + 4} /> : null}
    </g>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const id = `num-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <input id={id} className="input" type="number" min={min} max={max} step={10} value={value}
        onChange={(ev) => { const n = Number(ev.target.value); if (Number.isFinite(n)) onChange(clamp(Math.round(n), min, max)); }} />
    </div>
  );
}

function Geometry({ e, floor, onChange }: { e: FloorElement; floor: { width: number; height: number }; onChange: (p: Partial<FloorElement>) => void }) {
  return (
    <div className="floor-geometry">
      <NumberField label="Left" value={e.x} min={0} max={floor.width} onChange={(x) => onChange({ x })} />
      <NumberField label="Top" value={e.y} min={0} max={floor.height} onChange={(y) => onChange({ y })} />
      <NumberField label="Size across" value={e.width} min={4} max={floor.width} onChange={(width) => onChange({ width })} />
      <NumberField label="Size down" value={e.height} min={4} max={floor.height} onChange={(height) => onChange({ height })} />
    </div>
  );
}

function TablePanel({ table, e, photos, floor, onChange }: {
  table: SeatingTable; e: FloorElement; photos: Photo[]; floor: { width: number; height: number }; onChange: (p: Partial<FloorElement>) => void;
}) {
  const action = useAction();
  const [shape, setShape] = useState(table.shape);
  const [features, setFeatures] = useState(new Set(table.features));
  const [photo, setPhoto] = useState(table.photo_media_id ?? "");
  return (
    <form className="card book-card" aria-labelledby="table-panel-heading" data-testid="table-panel" onSubmit={(ev) => {
      ev.preventDefault();
      void action.run("table", "PATCH", `/api/v1/partner/resources/${table.id}/details`, {
        shape, features: [...features], photo_media_id: photo || null, expected_version: table.version
      }, { success: "Table saved." });
    }}>
      <h2 id="table-panel-heading">{table.label}</h2>
      <p className="book-when">
        {table.capacity} {table.capacity === 1 ? "seat" : "seats"} · {table.hourly_paise !== null ? `${formatInrPaise(table.hourly_paise)}/hr` : "no price yet"}
        {table.status !== "ACTIVE" ? " · paused" : ""}
      </p>
      <p className="field-hint">Name, seats and price are edited in Inventory and Prices.</p>
      {photos.length > 0 ? (
        <div className="field">
          <label className="field-label" htmlFor="table-photo">Photo guests see</label>
          <select id="table-photo" className="input" value={photo} onChange={(ev) => setPhoto(ev.target.value)}>
            <option value="">No photo</option>
            {photos.map((p) => <option key={p.id} value={p.id}>{p.alt_text}</option>)}
          </select>
          {photo ? <img className="table-photo" src={`/api/v1/media/${photo}`} alt="" /> : null}
        </div>
      ) : <p className="field-hint">Add approved venue photos to pick one for this table.</p>}
      <fieldset className="chip-checks">
        <legend className="field-label">Shape</legend>
        {Object.entries(SHAPE_LABEL).map(([code, label]) => (
          <label key={code} className={`choice-pill${shape === code ? " selected" : ""}`}>
            <input type="radio" name="shape" checked={shape === code} onChange={() => setShape(code as SeatingTable["shape"])} />
            {label}
          </label>
        ))}
      </fieldset>
      <fieldset className="chip-checks">
        <legend className="field-label">What guests get</legend>
        {Object.entries(TABLE_FEATURE_LABEL).map(([code, label]) => (
          <label key={code} className={`choice-pill${features.has(code) ? " selected" : ""}`}>
            <input type="checkbox" checked={features.has(code)} onChange={(ev) => {
              const next = new Set(features);
              if (ev.target.checked) next.add(code); else next.delete(code);
              setFeatures(next);
            }} />
            {label}
          </label>
        ))}
      </fieldset>
      <Button variant="secondary" type="submit" loading={action.busy === "table"}>Save table</Button>
      <Status message={action.message} />
      <details className="floor-advanced">
        <summary>Exact position</summary>
        <Geometry e={e} floor={floor} onChange={onChange} />
      </details>
    </form>
  );
}

function ItemPanel({ e, floor, onChange }: { e: FloorElement; floor: { width: number; height: number }; onChange: (p: Partial<FloorElement>) => void }) {
  const kind = FIXTURE_LABEL[e.type as Exclude<ElementType, "TABLE">];
  return (
    <Card className="book-card" aria-labelledby="item-panel-heading">
      <h2 id="item-panel-heading">{kind}</h2>
      <div className="field">
        <label className="field-label" htmlFor="item-label">Label (optional)</label>
        <input id="item-label" className="input" value={e.label ?? ""} maxLength={40} placeholder={kind}
          onChange={(ev) => onChange({ label: ev.target.value || undefined })} />
      </div>
      <Geometry e={e} floor={floor} onChange={onChange} />
      <p className="field-hint"><Info size={14} aria-hidden="true" /> Room items are only for orientation; guests cannot book them.</p>
    </Card>
  );
}

function MoveIntoArea({ zone, tables }: { zone: Zone; tables: SeatingTable[] }) {
  const action = useAction();
  return (
    <div className="move-into">
      <p className="field-hint">Tables not in any area yet:</p>
      <div className="choice-pills">
        {tables.map((t) => (
          <button key={t.id} type="button" className="choice-pill" disabled={action.busy !== null}
            onClick={() => void action.run(`move-${t.id}`, "PATCH", `/api/v1/partner/resources/${t.id}/details`, { zone_id: zone.id, expected_version: t.version },
              { success: `${t.label} is now in ${zone.name}.` })}>
            Move {t.label} here
          </button>
        ))}
      </div>
      <Status message={action.message} />
    </div>
  );
}
