// C04 native venue: rules before any selection, then advisory start times per table for the chosen day.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, ScrollView, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import type { VenueAvailability, VenueDetail } from "@simply-sit/contracts";
import { colors } from "@simply-sit/design-tokens";
import { Button, Card, Chip, MockBadge, Notice, ui } from "../../components/ui";
import { api, apiUrl } from "../../lib/api";
import { FOOD_RULE_LABEL, durationLabel, formatInrPaise, formatIstDate, formatIstTime, istDateKey } from "../../lib/format";
import { SALE_NOTICE } from "../../lib/sales-state";
import { useSalesState } from "../../lib/service-status";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function VenueScreen() {
  const params = useLocalSearchParams<{ id: string; date?: string; duration?: string; party?: string }>();
  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dayKey, setDayKey] = useState(params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : istDateKey(0));
  const [duration, setDuration] = useState(Number(params.duration) || 60);
  const [party, setParty] = useState(Number(params.party) || 2);
  const [slots, setSlots] = useState<VenueAvailability | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const sales = useSalesState();

  useEffect(() => {
    if (!api) return;
    api.getVenue(String(params.id)).then(setVenue).catch(() => setError("This venue is not available."));
  }, [params.id]);

  const loadSlots = useCallback(async () => {
    if (!api || !venue) return;
    setSlots(null);
    setSlotsError(null);
    try {
      setSlots(await api.getAvailability(venue.id, { date: dayKey, duration_minutes: duration, party_size: party }));
    } catch {
      setSlotsError("Times could not be loaded. Check your connection and try again.");
    }
  }, [venue, dayKey, duration, party]);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  if (error) {
    return (
      <View style={ui.screen}>
        <Stack.Screen options={{ title: "Not available" }} />
        <Notice tone="error">{error}</Notice>
      </View>
    );
  }
  if (!venue) return <ActivityIndicator style={{ marginTop: 48 }} color={colors.brandPrimary} accessibilityLabel="Loading venue" />;
  const p = venue.policy;
  const durations: number[] = [];
  for (let m = p.minimum_minutes; m <= p.maximum_minutes; m += p.increment_minutes) if (m % 30 === 0) durations.push(m);

  return (
    <ScrollView contentContainerStyle={ui.screen}>
      <Stack.Screen options={{ title: venue.name }} />
      {venue.is_synthetic ? <MockBadge text="Synthetic demo venue - fictional prices and rules" /> : null}
      <Text style={ui.title}>{venue.name}</Text>
      <Text style={ui.small}>
        {venue.locality} · {venue.address}
      </Text>
      {venue.reviews.count > 0 ? (
        <Text style={ui.body} testID="venue-rating">{`Rated ${venue.reviews.average} of 5 (${venue.reviews.count} ${venue.reviews.count === 1 ? "review" : "reviews"})`}</Text>
      ) : null}
      {venue.photos.length > 0 && apiUrl ? (
        // Approved photos only, served by the API proxy (public for published venues).
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} testID="venue-photos">
          {venue.photos.map((p) => (
            <Image key={p.id} source={{ uri: `${apiUrl}/api/v1/media/${p.id}` }} accessibilityLabel={p.alt_text} accessible
              style={{ width: 260, height: 160, borderRadius: 8 }} resizeMode="cover" />
          ))}
        </ScrollView>
      ) : null}

      <Card>
        <Text style={ui.heading}>Food and house rules</Text>
        <Text style={ui.body}>
          Outside food: <Text style={{ fontWeight: "700" }}>{FOOD_RULE_LABEL[p.byo_food]}</Text>. {p.byo_details}
        </Text>
        <Text style={ui.body}>
          Outside delivery: <Text style={{ fontWeight: "700" }}>{FOOD_RULE_LABEL[p.outside_delivery]}</Text>. Buying food here is optional.
        </Text>
        <Text style={ui.small}>{p.house_rules}</Text>
        <Text style={ui.small}>
          Cancellation (proposed): full refund up to {p.cancel_cutoff_minutes / 60} h before the start, none after. {p.buffer_minutes}-minute cleaning after
          each booking.
        </Text>
      </Card>

      <Card>
        <Text style={ui.heading}>Choose a time</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ui.row}>
          {Array.from({ length: 7 }, (_, i) => istDateKey(i)).map((key, i) => (
            <Chip key={key} label={i === 0 ? "Today" : i === 1 ? "Tomorrow" : formatIstDate(Date.now() + i * 86_400_000)} selected={dayKey === key}
              onPress={() => setDayKey(key)} />
          ))}
        </ScrollView>
        <View style={ui.row}>
          {durations.map((d) => (
            <Chip key={d} label={durationLabel(d)} selected={duration === d} onPress={() => setDuration(d)} />
          ))}
        </View>
        <View style={ui.row}>
          <Button label="-" variant="secondary" onPress={() => setParty((n) => Math.max(1, n - 1))} hint="Fewer people" />
          <Text style={ui.body}>
            {party} {party === 1 ? "person" : "people"}
          </Text>
          <Button label="+" variant="secondary" onPress={() => setParty((n) => Math.min(20, n + 1))} hint="More people" />
        </View>
        {sales && sales.bookings !== "open" ? (
          <View testID="bookings-paused">
            <Notice tone="warning">{SALE_NOTICE[sales.bookings].bookings}</Notice>
          </View>
        ) : null}
        {slotsError ? (
          <Notice tone="error">
            <Text style={[ui.body, { color: colors.statusError }]}>{slotsError}</Text>
            <Button label="Try again" onPress={() => void loadSlots()} />
          </Notice>
        ) : null}
        {!slots && !slotsError ? <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading times" /> : null}
        {slots && slots.tables.length === 0 ? <Notice>{`No table here seats ${party}.`}</Notice> : null}
        {(sales && sales.bookings !== "open" ? [] : slots?.tables ?? []).map((table) => (
          <View key={table.resource_id} style={{ gap: 8 }} testID="table-slots">
            <Text style={ui.body}>
              {table.label} · up to {table.capacity}
              {"total_paise" in table.price ? ` · ${formatInrPaise(table.price.total_paise)}` : ""}
            </Text>
            {table.starts.length === 0 ? <Text style={ui.small}>No free start times for {durationLabel(duration)}.</Text> : null}
            <View style={ui.row}>
              {table.starts.slice(0, 24).map((start) => (
                <Chip key={start} label={formatIstTime(start)} selected={false} testID="slot"
                  onPress={() => router.push({
                    pathname: "/book",
                    params: { venueId: venue.id, venueName: venue.name, resourceId: table.resource_id, start, duration: String(duration), party: String(party) }
                  })} />
              ))}
            </View>
          </View>
        ))}
        <Text style={ui.small}>Times are IST and are checked again when you hold the table.</Text>
      </Card>

      <Card>
        <Text style={ui.heading}>Bookable hours (IST)</Text>
        {venue.hours.map((h) => (
          <Text key={`${h.weekday}-${h.opens}`} style={ui.small}>
            {WEEKDAYS[h.weekday]}: {h.opens}-{h.closes}
            {h.closes_next_day ? " (next day)" : ""}
          </Text>
        ))}
      </Card>
    </ScrollView>
  );
}
