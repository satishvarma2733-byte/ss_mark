// C01/C03 native search. Manual pilot area works without any permission; "Use my location" asks only after a tap,
// uses approximate location, rounds to about 1 km before sending, and never asks again after a denial.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import * as Location from "expo-location";
import { ApiError } from "@simply-sit/api-client";
import { PILOT_AREAS, REQUIREMENT_TAGS, coarseCoordinate, type VenueSearchItem, type VenueSearchResult } from "@simply-sit/contracts";
import { colors, radius, spacing } from "@simply-sit/design-tokens";
import { SYNTHETIC_BANNER } from "@simply-sit/synthetic-data";
import { Button, Card, Chip, Field, MockBadge, Notice, StatusPill, fonts, ui } from "../../components/ui";
import { Screen } from "../../components/shell";
import { api } from "../../lib/api";
import { FOOD_RULE_LABEL, durationLabel, formatInrPaise, formatIstDate, istDateKey, istInstant } from "../../lib/format";

const TIMES = Array.from({ length: 31 }, (_, i) => {
  const m = 7 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});
const DURATIONS = [60, 90, 120, 180, 240];
const LABEL: Record<string, string> = {
  WORK: "Work", MEET: "Meet", WAIT: "Wait", STUDY: "Study", GATHER: "Gather", RELAX: "Relax",
  CAFE: "Cafe", HOTEL: "Hotel", RESTAURANT: "Restaurant", LOUNGE: "Lounge", BREWERY: "Brewery", WORKSPACE: "Workspace"
};

type Origin = { kind: "area"; code: string } | { kind: "device"; lat: number; lng: number };
type State = { status: "loading" } | { status: "ready"; result: VenueSearchResult; stale: boolean } | { status: "error"; message: string; previous?: VenueSearchResult };

export default function SearchScreen() {
  const [origin, setOrigin] = useState<Origin>({ kind: "area", code: "koramangala" });
  // The manual location screen (app/location.tsx) returns a pilot area or a rounded device position.
  const params = useLocalSearchParams<{ area?: string; lat?: string; lng?: string }>();
  useEffect(() => {
    if (params.area && PILOT_AREAS.some((a) => a.code === params.area)) setOrigin({ kind: "area", code: params.area });
    else if (params.lat && params.lng && Number.isFinite(Number(params.lat)) && Number.isFinite(Number(params.lng))) {
      setOrigin({ kind: "device", lat: coarseCoordinate(Number(params.lat)), lng: coarseCoordinate(Number(params.lng)) });
    }
  }, [params.area, params.lat, params.lng]);
  const [day, setDay] = useState(0);
  const [time, setTime] = useState<string | null>(null);
  const [duration, setDuration] = useState(60);
  const [party, setParty] = useState(2);
  const [requirement, setRequirement] = useState<string | null>(null);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [view, setView] = useState<"list" | "map">("list");
  const [state, setState] = useState<State>({ status: "loading" });
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationBlocked, setLocationBlocked] = useState(false);

  const criteria = useMemo(() => ({
    ...(origin.kind === "area" ? { area: origin.code } : { lat: origin.lat, lng: origin.lng }),
    ...(time ? { start_at: istInstant(istDateKey(day), time), duration_minutes: duration, available_only: availableOnly } : {}),
    party_size: party,
    ...(requirement ? { requirement } : {})
  }), [origin, day, time, duration, party, requirement, availableOnly]);

  const search = useCallback(async () => {
    if (!api) {
      setState({ status: "error", message: "This build has no API configured (EXPO_PUBLIC_API_URL)." });
      return;
    }
    setState((s) => (s.status === "ready" ? { ...s, stale: true } : { status: "loading" }));
    try {
      const result = await api.searchVenues(criteria);
      setState({ status: "ready", result, stale: false });
    } catch (error) {
      const message = error instanceof ApiError && error.code === "NETWORK" ? error.message : "We could not load spaces. Try again.";
      setState((s) => ({ status: "error", message, ...(s.status === "ready" ? { previous: s.result } : {}) }));
    }
  }, [criteria]);

  // Next page of the same search, appended to the list (the API pages by an opaque cursor).
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const loadMore = useCallback(async () => {
    if (!api || state.status !== "ready" || !state.result.next_cursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.searchVenues({ ...criteria, cursor: state.result.next_cursor });
      setState((s) => (s.status === "ready"
        ? { ...s, result: { ...page, venues: [...s.result.venues, ...page.venues] } }
        : s));
    } catch {
      setMoreError("More spaces could not be loaded. Check your connection and try again.");
    } finally {
      setLoadingMore(false);
    }
  }, [criteria, state]);

  useEffect(() => {
    void search();
  }, [search]);

  async function useMyLocation() {
    if (locationBlocked) {
      setLocationNote("Location is off for Simply Sit. Choose an area instead, or allow location in system settings.");
      return;
    }
    setLocating(true);
    setLocationNote(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setLocationBlocked(!permission.canAskAgain);
        setLocationNote("Location was not shared. Choose an area instead.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      setOrigin({ kind: "device", lat: coarseCoordinate(position.coords.latitude), lng: coarseCoordinate(position.coords.longitude) });
      setLocationNote("Using your approximate location (about 1 km).");
    } catch {
      setLocationNote("We could not get your location. Choose an area instead.");
    } finally {
      setLocating(false);
    }
  }

  const result = state.status === "ready" ? state.result : state.status === "error" ? state.previous : undefined;

  const areaLabel = origin.kind === "area" ? `${PILOT_AREAS.find((a) => a.code === origin.code)?.label ?? origin.code}, Bengaluru` : "Near you (about 1 km)";
  const whenLabel = `${day === 0 ? "today" : day === 1 ? "tomorrow" : formatIstDate(Date.now() + day * 86_400_000)}${time ? ` at ${time} for ${durationLabel(duration)}` : ", any time"}`;
  const filtered = requirement !== null || availableOnly;
  const openLocation = () => router.push({ pathname: "/location" as never, params: origin.kind === "area" ? { area: origin.code } : {} });

  return (
    <Screen title="Find your space" subtitle={`Explore ${areaLabel}`}>
      <StatusPill label={SYNTHETIC_BANNER} tone="neutral" />
      <Text style={ui.display}>Your space. Your time.</Text>
      <Text style={ui.muted}>Food purchase is optional. Whether outside food or delivery is allowed depends on each venue.</Text>

      <Card title="Your search">
        <Field label="Area">
          <Pressable onPress={openLocation} accessibilityRole="button" accessibilityLabel={`Area: ${areaLabel}. Change area`}
            style={[ui.input, styles.fieldButton]} testID="change-area">
            <Text style={ui.body}>{areaLabel}</Text>
            <Text style={styles.change}>Change →</Text>
          </Pressable>
        </Field>
        {locationNote ? <Text style={ui.hint} accessibilityLiveRegion="polite">{locationNote}</Text> : null}
        <Button label={locating ? "Locating…" : "Use my location"} variant="secondary" busy={locating} onPress={() => void useMyLocation()} testID="use-location" />
        <Field label="Date">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ui.row}>
            {Array.from({ length: 7 }, (_, i) => (
              <Chip key={i} label={i === 0 ? "Today" : i === 1 ? "Tomorrow" : formatIstDate(Date.now() + i * 86_400_000)} selected={day === i} onPress={() => setDay(i)} />
            ))}
          </ScrollView>
        </Field>
        <Field label="Start time · IST">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ui.row}>
            <Chip label="Any time" selected={time === null} onPress={() => setTime(null)} />
            {TIMES.map((t) => (
              <Chip key={t} label={t} selected={time === t} onPress={() => setTime(t)} />
            ))}
          </ScrollView>
        </Field>
        <Field label="Duration">
          <View style={ui.row}>
            {DURATIONS.map((d) => (
              <Chip key={d} label={durationLabel(d)} selected={duration === d} onPress={() => setDuration(d)} />
            ))}
          </View>
        </Field>
        <Field label="Party">
          <View style={ui.row}>
            <Button label="-" variant="secondary" onPress={() => setParty((p) => Math.max(1, p - 1))} hint="Fewer people" />
            <Text style={ui.body} accessibilityLabel={`${party} people`}>
              {party} {party === 1 ? "guest" : "guests"}
            </Text>
            <Button label="+" variant="secondary" onPress={() => setParty((p) => Math.min(10, p + 1))} hint="More people" />
          </View>
        </Field>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ui.row}>
          <Chip label="Anything" selected={requirement === null} onPress={() => setRequirement(null)} />
          {REQUIREMENT_TAGS.map((r) => (
            <Chip key={r} label={LABEL[r] ?? r} selected={requirement === r} onPress={() => setRequirement(r)} />
          ))}
        </ScrollView>
        {time ? <Chip label="Only free tables" selected={availableOnly} onPress={() => setAvailableOnly((v) => !v)} testID="available-only" /> : null}
      </Card>

      {state.status === "loading" ? (
        <View style={styles.stateBlock} accessibilityLabel="Loading spaces">
          <StatusPill label="Checking tables & availability" tone="sage" />
          {[0, 1].map((i) => (
            <View key={i} style={[ui.card, styles.skeletonCard]} accessible={false}>
              <View style={[styles.skeleton, styles.skeletonPhoto]} />
              <View style={[styles.skeletonLine, { width: "60%" }]} />
              <View style={[styles.skeletonLine, { width: "85%" }]} />
              <View style={[styles.skeletonLine, { width: "35%" }]} />
            </View>
          ))}
          <Text style={ui.hint}>Checking operating hours, capacity, holds, closures and cleaning. We haven’t found or reserved a table yet.</Text>
        </View>
      ) : null}

      {state.status === "error" ? (
        <View style={styles.stateBlock}>
          <Notice tone="error" title="We couldn’t check availability">
            {`${state.message} This doesn’t mean there are no tables; we just can’t confirm live results right now.`}
          </Notice>
          {state.previous ? <Text style={ui.hint}>Showing earlier results below, which may be out of date.</Text> : null}
          <Button label="Retry availability check" onPress={() => void search()} />
          <Text style={ui.hint}>No reservation or payment was created. Your area, date, time, party and filters are kept for the retry.</Text>
          <Card title="Still not loading?">
            <Text style={ui.muted}>Check your connection, then try again. Help with existing bookings is always available.</Text>
            <Button label="Get help" variant="secondary" onPress={() => router.navigate("/help")} />
          </Card>
        </View>
      ) : null}

      {result && result.venues.length > 0 ? (
        <View style={[ui.row, { justifyContent: "space-between" }]}>
          <Text style={ui.heading} accessibilityLiveRegion="polite">
            {`${result.total} ${result.total === 1 ? "space" : "spaces"}`}
          </Text>
          <View style={ui.row}>
            <Chip label="List" selected={view === "list"} onPress={() => setView("list")} />
            <Chip label="Map" selected={view === "map"} onPress={() => setView("map")} testID="map-view" />
          </View>
        </View>
      ) : null}
      {state.status === "ready" && state.stale ? <Text style={ui.hint}>Updating…</Text> : null}

      {result && result.venues.length === 0 && state.status !== "loading" ? (
        <View style={styles.stateBlock} testID="empty-results">
          <View style={styles.emptyMessage}>
            <Ionicons name="search-outline" size={48} color={colors.textPrimary} accessible={false} />
            <Text style={[ui.display, styles.centerText]}>No spaces match this search.</Text>
            <Text style={[ui.muted, styles.centerText]}>
              There are no matching tables for your area, time, party and filters. Try fewer filters or a nearby neighbourhood.
            </Text>
          </View>
          {filtered ? <Button label="Clear filters & search again" onPress={() => { setRequirement(null); setAvailableOnly(false); }} /> : null}
          {time ? <Button label="Try any time of day" variant={filtered ? "secondary" : "primary"} onPress={() => setTime(null)} /> : null}
          <Button label="Explore another area" variant="secondary" onPress={openLocation} />
          <Notice title="Your search stays with you">
            {`We keep ${whenLabel} and ${party} ${party === 1 ? "guest" : "guests"} when you change the area. Availability is checked again; alternatives aren’t guaranteed.`}
          </Notice>
        </View>
      ) : null}

      {result && view === "map" && result.venues.length > 0 ? <SchematicMap result={result} /> : null}
      {result?.venues.map((v, i) => (
        <VenueCard key={v.id} venue={v} index={i + 1} time={time} onOpen={() =>
          router.push({ pathname: "/venue/[id]", params: { id: v.id, date: istDateKey(day), duration: String(duration), party: String(party) } })} />
      ))}
      {state.status === "ready" && state.result.next_cursor ? (
        <Button label={`Show more spaces (${state.result.venues.length} of ${state.result.total})`} variant="secondary" busy={loadingMore}
          onPress={() => void loadMore()} testID="load-more" />
      ) : null}
      {moreError ? <Text style={[ui.small, { color: colors.statusError }]} accessibilityRole="alert">{moreError}</Text> : null}
    </Screen>
  );
}

function VenueCard({ venue, index, time, onOpen }: { venue: VenueSearchItem; index: number; time: string | null; onOpen: () => void }) {
  const a = venue.availability;
  const availability = !a ? null : a.available_tables > 0 ? `${a.available_tables} free at ${time}` : a.problems.includes("BOOKED") ? `Fully booked at ${time}` : "Not bookable at that time";
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${index}. ${venue.name}`} testID="venue-card">
      <Card>
        {venue.is_synthetic ? <MockBadge text="Synthetic demo" /> : null}
        <Text style={ui.heading}>
          {index}. {venue.name}
        </Text>
        <Text style={ui.small}>
          {LABEL[venue.category_code] ?? venue.category_code} · {venue.locality}
          {venue.distance_m !== null ? ` · ${(venue.distance_m / 1000).toFixed(1)} km` : ""}
        </Text>
        {venue.from_hourly_paise !== null ? <Text style={ui.price}>From {formatInrPaise(venue.from_hourly_paise)}/h</Text> : null}
        {availability ? <Text style={[ui.body, { color: a && a.available_tables > 0 ? colors.statusSuccess : colors.statusWarning }]}>{availability}</Text> : null}
        <Text style={ui.small}>
          Outside food: {FOOD_RULE_LABEL[venue.byo_food]} · Delivery: {FOOD_RULE_LABEL[venue.outside_delivery]}
        </Text>
      </Card>
    </Pressable>
  );
}

// No map provider is configured yet (owner account needed): markers are placed by relative coordinates.
function SchematicMap({ result }: { result: VenueSearchResult }) {
  const width = 320;
  const height = 200;
  const points = [...result.venues.map((v) => ({ lat: v.lat, lng: v.lng })), ...(result.area ? [{ lat: result.area.lat, lng: result.area.lng }] : [])];
  const minLat = Math.min(...points.map((p) => p.lat)) - 0.005;
  const maxLat = Math.max(...points.map((p) => p.lat)) + 0.005;
  const minLng = Math.min(...points.map((p) => p.lng)) - 0.005;
  const maxLng = Math.max(...points.map((p) => p.lng)) + 0.005;
  const x = (lng: number) => 12 + ((lng - minLng) / (maxLng - minLng)) * (width - 24);
  const y = (lat: number) => 12 + ((maxLat - lat) / (maxLat - minLat)) * (height - 24);
  return (
    <View accessibilityLabel="Schematic map of results" testID="schematic-map">
      <View style={[styles.map, { width, height }]}>
        {result.area ? <View style={[styles.origin, { left: x(result.area.lng) - 7, top: y(result.area.lat) - 7 }]} accessibilityLabel="Search centre" /> : null}
        {result.venues.map((v, i) => (
          <View key={v.id} style={[styles.pin, { left: x(v.lng) - 14, top: y(v.lat) - 14 }, v.availability?.available_tables === 0 && styles.pinMuted]}>
            <Text style={styles.pinText}>{i + 1}</Text>
          </View>
        ))}
      </View>
      <Text style={ui.small}>Schematic map - positions are approximate and not to scale. No map provider is configured.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldButton: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  change: { fontFamily: fonts.semibold, fontSize: 14, color: colors.brandPrimary },
  stateBlock: { gap: spacing.lg },
  emptyMessage: { alignItems: "center", gap: spacing.base, paddingVertical: spacing.base },
  centerText: { textAlign: "center" },
  skeletonCard: { gap: spacing.md },
  skeleton: { backgroundColor: "#EEEAE2", borderRadius: radius.button },
  skeletonPhoto: { height: 120, borderRadius: radius.card },
  skeletonLine: { height: 14, borderRadius: radius.button, backgroundColor: colors.noticeSurface },
  map: { backgroundColor: "#EBE6DA", borderRadius: radius.card, borderWidth: 1, borderColor: colors.brandSand, alignSelf: "center" },
  origin: { position: "absolute", width: 14, height: 14, borderRadius: 7, backgroundColor: colors.focusRing, borderWidth: 2, borderColor: colors.surfaceCard },
  pin: { position: "absolute", width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  pinMuted: { backgroundColor: colors.textMuted },
  pinText: { color: colors.surfaceCard, fontFamily: fonts.semibold }
});
