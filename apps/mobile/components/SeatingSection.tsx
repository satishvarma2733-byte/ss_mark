// Seat-map phase 3 - Figma "Customer · Choose seating area and table" (2063:220) and "Customer · Table details sheet"
// (2065:270). Areas with their "from" price, a start-time row, the published floor drawing coloured for that time
// (free, your pick, booked, too small), and a sheet with the table's photo, features, price and free start times.
// Drawn with plain Views (no native SVG module). Availability is advisory: the hold re-checks everything.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { busyHourText, type SeatMap, type VenueAvailability, type VenueSeating } from "@simply-sit/contracts";
import { colors, radius, spacing } from "@simply-sit/design-tokens";
import { api, apiUrl } from "../lib/api";
import { durationLabel, formatInrPaise, formatIstTime } from "../lib/format";
import { Button, Chip, Notice, fonts, ui } from "./ui";

type Zone = VenueSeating["zones"][number];
type Element = NonNullable<Zone["layout"]>["elements"][number];
type SeatState = SeatMap["tables"][number]["state"];

export const TABLE_FEATURE_LABEL: Record<string, string> = {
  WINDOW: "Window view", POWER_SOCKET: "Power socket", AIR_CONDITIONED: "Air-conditioned", SOFA_SEATING: "Sofa seating",
  STEP_FREE: "Step-free", QUIET: "Quiet corner", VIEW: "Nice view"
};
const KIND_LABEL: Record<Zone["kind"], string> = { INDOOR: "Indoor", OUTDOOR: "Outdoor", ROOFTOP: "Rooftop", PRIVATE_ROOM: "Private room" };
const KIND_ICON: Record<Zone["kind"], "home-outline" | "sunny-outline" | "cloud-outline" | "lock-closed-outline"> = {
  INDOOR: "home-outline", OUTDOOR: "sunny-outline", ROOFTOP: "cloud-outline", PRIVATE_ROOM: "lock-closed-outline"
};
const STATE_WORD: Record<SeatState, string> = { FREE: "free", BOOKED: "booked", TOO_SMALL: "too small for your group", UNAVAILABLE: "not available then" };
const shortLabel = (label: string) => label.replace(/^(Table|Desk|Long table|Courtyard|Window|Garden|Arch|Alcove)\s+/i, "");

export type HoldChoice = { resourceId: string; label: string; capacity: number; start: string };

export function SeatingSection(props: {
  venueId: string;
  seating: VenueSeating;
  slots: VenueAvailability | null;
  duration: number;
  party: number;
  onHold: (choice: HoldChoice) => void;
}) {
  const { seating, slots, duration, party } = props;
  const zones = seating.zones.filter((z) => z.layout);
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? null);
  const zone = zones.find((z) => z.id === zoneId) ?? zones[0] ?? null;
  const tableIds = useMemo(() => new Set((zone?.layout?.elements ?? []).filter((e) => e.resource_id).map((e) => e.resource_id!)), [zone]);
  // Start times offered for this area: any start at which at least one of its tables (big enough) is free.
  const starts = useMemo(
    () => [...new Set((slots?.tables ?? []).filter((t) => tableIds.has(t.resource_id)).flatMap((t) => t.starts))].sort(),
    [slots, tableIds]
  );
  const [start, setStart] = useState<string | null>(null);
  const chosenStart = start && starts.includes(start) ? start : starts[0] ?? null;
  const [map, setMap] = useState<SeatMap | null>(null);
  const [mapError, setMapError] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setMap(null);
    setMapError(false);
    if (!api || !chosenStart) return;
    api.getSeatMap(props.venueId, { start_at: chosenStart, duration_minutes: duration, party_size: party })
      .then((m) => live && setMap(m))
      .catch(() => live && setMapError(true));
    return () => {
      live = false;
    };
  }, [props.venueId, chosenStart, duration, party]);

  if (!zone || !zone.layout) return null;
  const state = new Map((map?.tables ?? []).map((t) => [t.resource_id, t]));
  const freeHere = (map?.tables ?? []).filter((t) => tableIds.has(t.resource_id) && t.state === "FREE").length;
  const openElement = open ? zone.layout.elements.find((e) => e.resource_id === open) ?? null : null;

  return (
    <View style={{ gap: spacing.md }} testID="seating-section">
      <View style={{ gap: 2 }}>
        <Text style={ui.heading} accessibilityRole="header">Where would you like to sit?</Text>
        <Text style={ui.small}>Each area has its own price. Pick one to see its tables.</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.zoneRow}>
        {zones.map((z) => {
          const selected = z.id === zone.id;
          return (
            <Pressable key={z.id} onPress={() => { setZoneId(z.id); setOpen(null); }} accessibilityRole="tab" accessibilityState={{ selected }}
              accessibilityLabel={`${z.name}, ${KIND_LABEL[z.kind]}${z.from_hourly_paise !== null ? `, from ${formatInrPaise(z.from_hourly_paise)} per hour` : ""}, ${z.table_count} tables`}
              style={[s.zoneCard, selected && s.zoneCardSelected]} testID="seating-zone">
              <Ionicons name={KIND_ICON[z.kind]} size={20} color={selected ? colors.brandPrimary : colors.textMuted} accessible={false} />
              <Text style={ui.label} numberOfLines={1}>{z.name}</Text>
              <Text style={ui.small}>{KIND_LABEL[z.kind]}</Text>
              {z.from_hourly_paise !== null ? <Text style={s.zonePrice}>{`From ${formatInrPaise(z.from_hourly_paise)}/hr`}</Text> : null}
              <Text style={ui.small}>{`${z.table_count} ${z.table_count === 1 ? "table" : "tables"}`}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {starts.length === 0 ? (
        slots ? <Notice>{`No table in ${zone.name} is free for ${party} ${party === 1 ? "guest" : "guests"} on this day for ${durationLabel(duration)}. Try another day, length or area.`}</Notice>
          : <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading times" />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <Text style={ui.label}>Start time · IST</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.zoneRow}>
            {starts.slice(0, 48).map((t) => (
              <Chip key={t} label={formatIstTime(t)} selected={t === chosenStart} onPress={() => setStart(t)} testID="seat-start" />
            ))}
          </ScrollView>
        </View>
      )}

      {chosenStart ? (
        <View style={s.mapCard}>
          <View style={s.mapHead}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={ui.cardTitle}>{`${zone.name} · ${KIND_LABEL[zone.kind]}`}</Text>
              <Text style={ui.small} testID="seat-map-summary">
                {map ? `${formatIstTime(chosenStart)}–${formatIstTime(map.end_at)} · ${party} ${party === 1 ? "guest" : "guests"} · ${freeHere} free` : "Checking tables..."}
              </Text>
            </View>
          </View>
          <Legend />
          {mapError ? <Notice tone="error">The table map could not be loaded. Use the list of tables below instead.</Notice> : null}
          <FloorView layout={zone.layout} state={state} selected={open} onPick={(id) => setOpen(id)} />
          <View style={s.hint}>
            <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} accessible={false} />
            <Text style={[ui.small, { flex: 1 }]}>Tap a table to see its photo, price and free times.</Text>
          </View>
        </View>
      ) : null}

      {openElement && openElement.table && chosenStart ? (
        <TableSheet element={openElement} zone={zone} seat={state.get(openElement.resource_id!) ?? null} start={chosenStart}
          tableStarts={(slots?.tables ?? []).find((t) => t.resource_id === openElement.resource_id)?.starts ?? []}
          duration={duration} party={party} onClose={() => setOpen(null)}
          onHold={(when) => { setOpen(null); props.onHold({ resourceId: openElement.resource_id!, label: openElement.table!.label, capacity: openElement.table!.capacity, start: when }); }} />
      ) : null}
    </View>
  );
}

function Legend() {
  const items: [string, object][] = [["Free", s.swFree], ["Your pick", s.swPick], ["Booked", s.swBooked], ["Too small", s.swSmall]];
  return (
    <View style={s.legend} accessible accessibilityLabel="Legend: outlined tables are free, filled green is your pick, grey is booked, dashed is too small">
      {items.map(([label, style]) => (
        <View key={label} style={s.legendItem}>
          <View style={[s.swatch, style]} />
          <Text style={ui.small}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

// The published drawing scaled to the card width. Tables are buttons; room items are for orientation only.
function FloorView({ layout, state, selected, onPick }: {
  layout: NonNullable<Zone["layout"]>; state: Map<string, SeatMap["tables"][number]>; selected: string | null; onPick: (id: string) => void;
}) {
  const [width, setWidth] = useState(0);
  const k = width > 0 ? width / layout.width : 0;
  return (
    <View style={[s.floor, { height: k ? layout.height * k : 240 }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} testID="seat-map">
      {k > 0 ? layout.elements.map((e, i) => <FloorItem key={`${e.type}-${e.resource_id ?? i}`} e={e} k={k}
        seat={e.resource_id ? state.get(e.resource_id) ?? null : null} selected={!!e.resource_id && e.resource_id === selected} onPick={onPick} />) : null}
    </View>
  );
}

function FloorItem({ e, k, seat, selected, onPick }: {
  e: Element; k: number; seat: SeatMap["tables"][number] | null; selected: boolean; onPick: (id: string) => void;
}) {
  const turned = e.rotation === 90 || e.rotation === 270;
  const w = (turned ? e.height : e.width) * k;
  const h = (turned ? e.width : e.height) * k;
  const box = { position: "absolute" as const, left: e.x * k, top: e.y * k, width: w, height: h };
  const font = Math.max(9, Math.min(13, Math.min(w, h) / 4));
  if (e.type === "TABLE" && e.table && e.resource_id) {
    const st: SeatState = seat?.state ?? "UNAVAILABLE";
    const round = e.table.shape === "ROUND" || e.table.shape === "BAR_STOOL";
    const look = selected ? s.tPick : st === "FREE" ? s.tFree : st === "TOO_SMALL" ? s.tSmall : s.tBooked;
    const price = e.table.hourly_paise !== null ? `, ${formatInrPaise(e.table.hourly_paise)} per hour` : "";
    return (
      <Pressable onPress={() => onPick(e.resource_id!)} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected }}
        accessibilityLabel={`${e.table.label}, ${e.table.capacity} ${e.table.capacity === 1 ? "seat" : "seats"}, ${STATE_WORD[st]}${price}`}
        style={[box, s.table, look, { borderRadius: round ? Math.min(w, h) / 2 : 8 }]} testID={`seat-${e.table.label}`}>
        <Text style={[s.tableText, { fontSize: font }, selected && s.tableTextPick, st !== "FREE" && !selected && s.tableTextMuted]} numberOfLines={1}>
          {shortLabel(e.table.label).length * font * 0.62 > w - 6 ? shortLabel(e.table.label).split(/\s+/).at(-1) : shortLabel(e.table.label)}
        </Text>
        {h > 34 ? <Text style={[s.tableSeats, selected && s.tableTextPick]}>{e.table.capacity}</Text> : null}
      </Pressable>
    );
  }
  const fixture = e.type === "WALL" || e.type === "PILLAR" ? s.fWall : e.type === "WINDOW" ? s.fWindow : e.type === "DOOR" ? s.fDoor
    : e.type === "PLANT" ? s.fPlant : e.type === "LABEL" ? s.fLabel : s.fCounter;
  return (
    <View style={[box, s.fixture, fixture, (e.type === "PLANT" || e.type === "PILLAR") && { borderRadius: Math.min(w, h) / 2 }]}
      accessible={!!e.label} accessibilityLabel={e.label ?? undefined}>
      {e.label && w > 30 && h > 14 ? <Text style={[s.fixtureText, e.type === "DOOR" && s.fixtureDoor]} numberOfLines={1}>{e.label}</Text> : null}
    </View>
  );
}

function TableSheet({ element, zone, seat, start, tableStarts, duration, party, onClose, onHold }: {
  element: Element; zone: Zone; seat: SeatMap["tables"][number] | null; start: string; tableStarts: string[];
  duration: number; party: number; onClose: () => void; onHold: (start: string) => void;
}) {
  const table = element.table!;
  const [when, setWhen] = useState(tableStarts.includes(start) ? start : tableStarts[0] ?? null);
  const total = seat && "total_paise" in seat.price && seat.state === "FREE" && when === start ? seat.price.total_paise : null;
  const tooSmall = table.capacity < party;
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close table details" />
      <View style={s.sheet} testID="table-sheet">
        <View style={s.handle} />
        <ScrollView contentContainerStyle={{ gap: spacing.md }}>
          {table.photo && apiUrl ? (
            <Image source={{ uri: `${apiUrl}/api/v1/media/${table.photo.id}` }} style={s.photo} resizeMode="cover" accessibilityLabel={table.photo.alt_text} />
          ) : null}
          <View style={s.sheetHead}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={ui.heading} accessibilityRole="header">{table.label}</Text>
              <Text style={ui.small}>{`${zone.name} · ${KIND_LABEL[zone.kind]}`}</Text>
            </View>
            {table.hourly_paise !== null ? (
              <View style={{ alignItems: "flex-end" }}>
                <Text style={s.sheetPrice}>{`${formatInrPaise(table.hourly_paise)}/hr`}</Text>
                <Text style={ui.small}>per table</Text>
              </View>
            ) : null}
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={s.close}>
              <Ionicons name="close" size={20} color={colors.textPrimary} accessible={false} />
            </Pressable>
          </View>
          <View style={ui.row}>
            <View style={s.feature}><Text style={s.featureText}>{`Seats ${table.capacity}`}</Text></View>
            {table.features.map((f) => (
              <View key={f} style={s.feature}><Text style={s.featureText}>{TABLE_FEATURE_LABEL[f] ?? f}</Text></View>
            ))}
          </View>
          {tooSmall ? (
            <Notice tone="warning">{`This table seats ${table.capacity}. Choose fewer guests or another table.`}</Notice>
          ) : tableStarts.length === 0 ? (
            <Notice>{`${table.label} has no free start for ${durationLabel(duration)} on this day.`}</Notice>
          ) : (
            <View style={{ gap: spacing.sm }}>
              <Text style={ui.label}>{seat?.state === "FREE" ? "Start time · IST" : `Booked at ${formatIstTime(start)} · free at`}</Text>
              <View style={ui.row}>
                {tableStarts.slice(0, 16).map((t) => <Chip key={t} label={formatIstTime(t)} selected={t === when} onPress={() => setWhen(t)} testID="sheet-start" />)}
              </View>
            </View>
          )}
          {when && !tooSmall && tableStarts.length > 0 ? (
            <>
              <View style={s.totalRow}>
                <View style={{ flex: 1 }}>
                  <Text style={ui.label}>{`${formatIstTime(when)} · ${durationLabel(duration)} · ${party} ${party === 1 ? "guest" : "guests"}`}</Text>
                  <Text style={ui.small}>No compulsory food order</Text>
                </View>
                {total !== null ? <Text style={s.sheetPrice}>{formatInrPaise(total)}</Text> : null}
              </View>
              {total !== null && seat && "total_paise" in seat.price && busyHourText(seat.price) ? (
                <Text style={ui.small} testID="sheet-busy">{`Includes a busy-hour price (${busyHourText(seat.price)}).`}</Text>
              ) : null}
              <Button label={`Hold ${shortLabel(table.label)} at ${formatIstTime(when)}`} onPress={() => onHold(when)} testID="sheet-hold" />
              <Text style={ui.small}>Nothing is charged until you pay. Availability is checked again when you hold.</Text>
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  zoneRow: { gap: spacing.sm, paddingRight: spacing.base },
  zoneCard: {
    width: 156, gap: 3, padding: spacing.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.brandSand, backgroundColor: colors.surfaceCard
  },
  zoneCardSelected: { borderWidth: 2, borderColor: colors.brandPrimary, backgroundColor: colors.statusSuccessSurface },
  zonePrice: { fontFamily: fonts.semibold, fontSize: 12, color: colors.brandPrimary },
  mapCard: { gap: spacing.md, padding: spacing.base, borderRadius: radius.card, borderWidth: 1, borderColor: colors.brandSand, backgroundColor: colors.surfaceCard },
  mapHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 14, height: 14, borderRadius: 4, borderWidth: 1.5 },
  swFree: { backgroundColor: colors.surfaceCard, borderColor: colors.brandPrimary },
  swPick: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  swBooked: { backgroundColor: colors.surfaceMuted, borderColor: colors.textMuted },
  swSmall: { backgroundColor: colors.surfaceCard, borderColor: colors.textMuted, borderStyle: "dashed" },
  floor: { width: "100%", borderRadius: 12, borderWidth: 2, borderColor: colors.brandSand, backgroundColor: colors.surfaceCanvas, overflow: "hidden" },
  table: { alignItems: "center", justifyContent: "center", borderWidth: 2 },
  tFree: { backgroundColor: colors.surfaceCard, borderColor: colors.brandPrimary },
  tPick: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tBooked: { backgroundColor: colors.surfaceMuted, borderColor: colors.textMuted },
  tSmall: { backgroundColor: colors.surfaceCard, borderColor: colors.textMuted, borderStyle: "dashed", opacity: 0.6 },
  tableText: { fontFamily: fonts.semibold, color: colors.textPrimary, paddingHorizontal: 2 },
  tableTextPick: { color: colors.surfaceCard },
  tableTextMuted: { color: colors.textMuted },
  tableSeats: { fontFamily: fonts.regular, fontSize: 10, color: colors.textMuted },
  fixture: { alignItems: "center", justifyContent: "center", borderRadius: 4 },
  fWall: { backgroundColor: colors.textMuted },
  fWindow: { backgroundColor: colors.brandSage },
  fDoor: { borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.brandPrimary, backgroundColor: colors.surfaceCard },
  fCounter: { backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.brandSand },
  fPlant: { backgroundColor: colors.brandSage, opacity: 0.6 },
  fLabel: {},
  fixtureText: { fontFamily: fonts.medium, fontSize: 10, color: colors.textMuted },
  fixtureDoor: { color: colors.brandPrimary, fontFamily: fonts.semibold },
  hint: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
  scrim: { flex: 1, backgroundColor: "rgba(28, 31, 26, 0.5)" },
  sheet: {
    maxHeight: "86%", padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm, backgroundColor: colors.surfaceCard,
    borderTopLeftRadius: 24, borderTopRightRadius: 24
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.brandSand, marginBottom: spacing.sm },
  photo: { width: "100%", height: 150, borderRadius: radius.card, backgroundColor: colors.mapSurface },
  sheetHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  sheetPrice: { fontFamily: fonts.semibold, fontSize: 18, color: colors.brandPrimary },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceCanvas },
  feature: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.button, backgroundColor: colors.surfaceMuted },
  featureText: { fontFamily: fonts.medium, fontSize: 12, color: colors.textPrimary },
  totalRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.brandSand }
});
