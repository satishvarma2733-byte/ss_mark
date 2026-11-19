// C04 native venue - Figma "Customer · Venue detail" (94:9976): a photo that opens the gallery, the venue's identity,
// quick facts, amenities, tables with their hourly price and free start times, food rules, house rules, a recent review
// and a pinned price bar. Rules come before any selection; times are advisory and checked again when a table is held.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ComponentRef } from "react";
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { venueMonogram, type VenueAvailability, type VenueDetail } from "@simply-sit/contracts";
import { colors, radius, spacing } from "@simply-sit/design-tokens";
import { Screen } from "../../components/shell";
import { Button, Card, Chip, MockBadge, Notice, fonts, ui } from "../../components/ui";
import { api, apiUrl } from "../../lib/api";
import { FOOD_RULE_LABEL, durationLabel, formatInrPaise, formatIstDate, formatIstTime, istDateKey } from "../../lib/format";
import { tagLabel } from "../../lib/labels";
import { SALE_NOTICE } from "../../lib/sales-state";
import { useSalesState } from "../../lib/service-status";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Today's weekday in India (the venues' timezone), whatever the phone's own timezone is.
const istWeekday = () => new Date(Date.now() + 330 * 60_000).getUTCDay();
// "Chapter & Co." -> "CC": first letters of the first two words that start with a letter.
// Venue badge: the approved logo when there is one, else (or if the image fails to load) a monogram of the initials.
function VenueBadge({ venue }: { venue: VenueDetail }) {
  const [failed, setFailed] = useState(false);
  const logo = venue.logo && apiUrl && !failed ? venue.logo : null;
  return (
    <View style={s.logo} accessible accessibilityRole="image" accessibilityLabel={logo ? logo.alt_text : `${venue.name} logo`} testID="venue-logo">
      {logo ? (
        <Image source={{ uri: `${apiUrl}/api/v1/media/${logo.id}` }} style={s.logoImage} resizeMode="cover" accessible={false}
          onError={() => setFailed(true)} testID="venue-logo-image" />
      ) : (
        <Text style={s.logoText}>{venueMonogram(venue.name)}</Text>
      )}
    </View>
  );
}

function InfoRow(props: { icon: ComponentProps<typeof Ionicons>["name"]; label: string; value: string; tone?: "open"; testID?: string }) {
  return (
    <View style={s.infoRow} accessible accessibilityLabel={`${props.label}: ${props.value}`}>
      <View style={s.infoIcon}>
        <Ionicons name={props.icon} size={18} color={colors.brandPrimary} accessible={false} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={s.infoLabel}>{props.label}</Text>
        <Text style={[ui.body, props.tone === "open" && s.infoOpen]} testID={props.testID}>{props.value}</Text>
      </View>
    </View>
  );
}

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
  const scrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const tablesY = useRef(0);

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
      <Screen title="Not available" back nav="index">
        <Notice tone="error">{error}</Notice>
      </Screen>
    );
  }
  if (!venue) {
    return (
      <Screen title="Venue" back nav="index">
        <ActivityIndicator style={{ marginTop: 24 }} color={colors.brandPrimary} accessibilityLabel="Loading venue" />
      </Screen>
    );
  }

  const p = venue.policy;
  const durations: number[] = [];
  for (let m = p.minimum_minutes; m <= p.maximum_minutes; m += p.increment_minutes) if (m % 30 === 0) durations.push(m);
  const today = venue.hours.filter((h) => h.weekday === istWeekday());
  const fromPaise = venue.tables.map((t) => t.hourly_paise).filter((n): n is number => n !== null);
  const minHourly = fromPaise.length ? Math.min(...fromPaise) : null;
  const priceFor = (resourceId: string) => venue.tables.find((t) => t.resource_id === resourceId)?.hourly_paise ?? null;
  const review = venue.reviews.recent.find((r) => r.body);
  const paused = !!sales && sales.bookings !== "open";
  const firstPhoto = venue.photos[0];
  const dayLabel = dayKey === istDateKey(0) ? "Today" : dayKey === istDateKey(1) ? "Tomorrow" : formatIstDate(`${dayKey}T12:00:00+05:30`);
  const openGallery = () => router.push({ pathname: "/gallery/[id]", params: { id: venue.id } });
  // Short location: the area, plus the city when the address ends with one ("..., HAL 2nd Stage, Bengaluru").
  const city = venue.address.split(",").map((part) => part.trim()).filter(Boolean).at(-1);
  const shortLocation = city && city !== venue.locality ? `${venue.locality}, ${city}` : venue.locality;
  // Hours today against the IST clock; a venue may list more than one opening span.
  const nowIso = new Date().toISOString();
  const nowHm = formatIstTime(nowIso);
  const spans = today.map((h) => ({ opens: h.opens.slice(0, 5), closes: h.closes.slice(0, 5), overnight: h.closes_next_day }));
  const current = spans.find((h) => nowHm >= h.opens && (h.overnight || nowHm < h.closes));
  const later = spans.filter((h) => nowHm < h.opens).sort((a, b) => a.opens.localeCompare(b.opens))[0];
  const openNow = !!current;
  const openState = current
    ? `Open now · until ${current.closes}${current.overnight ? " (next day)" : ""}`
    : later ? `Closed now · opens ${later.opens}` : spans.length ? "Closed for the rest of today" : "Closed today";
  const nextFree = (slots?.tables ?? []).flatMap((t) => t.starts).sort()[0] ?? null;

  const footer = (
    <View style={s.footerRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.footerPrice} numberOfLines={1}>
          {minHourly !== null ? `From ${formatInrPaise(minHourly)} / hr` : "Prices shown per table"}
        </Text>
        <Text style={ui.small} numberOfLines={1}>
          {`${dayLabel} · ${durationLabel(duration)} · ${party} ${party === 1 ? "guest" : "guests"}`}
        </Text>
      </View>
      <Button label="Select table & time" onPress={() => scrollRef.current?.scrollTo({ y: Math.max(0, tablesY.current - 12), animated: true })}
        testID="select-table-time" />
    </View>
  );

  return (
    <Screen title={venue.name} subtitle={venue.locality} back nav="index" footer={footer} scrollRef={scrollRef}>
      {/* Cover photo with the venue's badge overlapping its lower edge. */}
      <View>
        {firstPhoto && apiUrl ? (
          // Approved photos only, served by the API proxy (public for published venues). Tapping opens the gallery.
          <Pressable onPress={openGallery} accessibilityRole="button" testID="venue-photos"
            accessibilityLabel={`Open photo gallery, ${venue.photos.length} ${venue.photos.length === 1 ? "photo" : "photos"}. ${firstPhoto.alt_text}`}>
            <Image source={{ uri: `${apiUrl}/api/v1/media/${firstPhoto.id}` }} style={s.cover} resizeMode="cover" accessible={false} />
            <View style={s.photoCount}>
              <Ionicons name="images-outline" size={14} color={colors.surfaceCard} accessible={false} />
              <Text style={s.photoCountText}>{`${venue.photos.length} ${venue.photos.length === 1 ? "photo" : "photos"}`}</Text>
            </View>
          </Pressable>
        ) : (
          <View style={[s.cover, s.coverEmpty]}>
            <Ionicons name="image-outline" size={28} color={colors.textMuted} accessible={false} />
            <Text style={ui.small}>Photos coming soon</Text>
          </View>
        )}
        <VenueBadge venue={venue} />
      </View>

      <View style={s.identity}>
        <Text style={s.eyebrow}>{`${tagLabel(venue.category_code)} · Table reservations`}</Text>
        <Text style={ui.display} accessibilityRole="header">{venue.name}</Text>
        <View style={s.shortLocation}>
          <Ionicons name="location-outline" size={15} color={colors.brandPrimary} accessible={false} />
          <Text style={s.shortLocationText} numberOfLines={1}>{shortLocation}</Text>
          <Pressable accessibilityRole="link" accessibilityLabel="Directions in OpenStreetMap" style={s.link} hitSlop={8}
            onPress={() => void Linking.openURL(`https://www.openstreetmap.org/?mlat=${venue.lat}&mlon=${venue.lng}#map=17/${venue.lat}/${venue.lng}`)}>
            <Text style={s.linkText}>Directions</Text>
            <Ionicons name="open-outline" size={14} color={colors.brandPrimary} accessible={false} />
          </Pressable>
        </View>
      </View>

      <Card>
        <InfoRow icon="map-outline" label="Address" value={venue.address} />
        <InfoRow icon="time-outline" label="Hours today" value={openState} tone={openNow ? "open" : undefined} />
        <InfoRow icon="calendar-outline" label="Date & time" value={`${formatIstDate(nowIso)} · ${formatIstTime(nowIso)} IST`} />
        <InfoRow icon="hourglass-outline" label="Next free table"
          value={paused ? "Bookings paused" : nextFree ? `${formatIstTime(nextFree)} · ${dayLabel}` : slots ? `None free ${dayLabel.toLowerCase() === "today" ? "today" : `on ${dayLabel}`}` : "Checking..."} />
        <InfoRow icon="star-outline" label="Rating" testID="venue-rating"
          value={venue.reviews.count > 0 && venue.reviews.average !== null
            ? `★ ${venue.reviews.average.toFixed(1)} · ${venue.reviews.count} guest ${venue.reviews.count === 1 ? "review" : "reviews"}`
            : "New on Simply Sit"} />
        <InfoRow icon="restaurant-outline" label="Food" value={`No compulsory order · Outside food ${FOOD_RULE_LABEL[p.byo_food].toLowerCase()}`} />
      </Card>

      <View style={{ gap: spacing.sm }}>
        {venue.description ? <Text style={ui.muted}>{venue.description}</Text> : null}
        {venue.is_synthetic ? <MockBadge text="Synthetic demo venue - fictional prices and rules" /> : null}
      </View>

      {venue.amenities.length > 0 ? (
        <View style={{ gap: spacing.md }}>
          <View style={{ gap: 2 }}>
            <Text style={ui.heading} accessibilityRole="header">Everything you need</Text>
            <Text style={ui.small}>Listed by the venue. Unverified ones are marked.</Text>
          </View>
          <View style={s.amenityGrid}>
            {venue.amenities.map((a) => (
              <View key={a.code} style={s.amenity}>
                <Ionicons name={a.verified ? "checkmark-circle-outline" : "ellipse-outline"} size={18} color={colors.brandPrimary} accessible={false} />
                <Text style={ui.body}>{`${tagLabel(a.code)}${a.verified ? "" : " (unverified)"}`}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ gap: spacing.md }} onLayout={(e) => { tablesY.current = e.nativeEvent.layout.y; }}>
        <Text style={ui.heading} accessibilityRole="header">Choose your kind of corner</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
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
        <View style={s.partyRow}>
          <Text style={ui.label}>Guests</Text>
          <View style={s.stepper}>
            <Button label="-" variant="secondary" onPress={() => setParty((n) => Math.max(1, n - 1))} hint="Fewer guests" />
            <Text style={[ui.body, s.partyValue]} accessibilityLiveRegion="polite">{`${party} ${party === 1 ? "guest" : "guests"}`}</Text>
            <Button label="+" variant="secondary" onPress={() => setParty((n) => Math.min(20, n + 1))} hint="More guests" />
          </View>
        </View>

        {sales && sales.bookings !== "open" ? (
          <View testID="bookings-paused">
            <Notice tone="warning">{SALE_NOTICE[sales.bookings].bookings}</Notice>
          </View>
        ) : null}
        {slotsError ? (
          <Notice tone="error" title="Times could not be loaded">
            <Text style={ui.noticeText}>Check your connection and try again.</Text>
            <Button label="Try again" variant="secondary" onPress={() => void loadSlots()} />
          </Notice>
        ) : null}
        {!slots && !slotsError && !paused ? <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading times" /> : null}
        {slots && slots.tables.length === 0 ? <Notice>{`No table here seats ${party}.`}</Notice> : null}
        {(paused ? [] : slots?.tables ?? []).map((table) => {
          const hourly = priceFor(table.resource_id);
          return (
            <Card key={table.resource_id} testID="table-slots">
              <View style={s.tableHead}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={ui.label}>{table.label}</Text>
                  <Text style={ui.small}>{`Seats up to ${table.capacity}`}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  {hourly !== null ? <Text style={ui.label}>{`${formatInrPaise(hourly)}/hr`}</Text> : null}
                  {"total_paise" in table.price ? <Text style={ui.small}>{`${formatInrPaise(table.price.total_paise)} for ${durationLabel(duration)}`}</Text> : null}
                </View>
              </View>
              {table.starts.length === 0 ? (
                <Text style={ui.small}>{`No free start times on this day for ${durationLabel(duration)}.`}</Text>
              ) : (
                <View style={ui.row}>
                  {table.starts.slice(0, 24).map((start) => (
                    <Chip key={start} label={formatIstTime(start)} selected={false} testID="slot"
                      onPress={() => router.push({
                        pathname: "/book",
                        params: { venueId: venue.id, venueName: venue.name, resourceId: table.resource_id, tableLabel: table.label, seats: String(table.capacity), start, duration: String(duration), party: String(party) }
                      })} />
                  ))}
                </View>
              )}
            </Card>
          );
        })}
        <Text style={ui.small}>Times are IST and are checked again when you hold the table.</Text>
      </View>

      <Notice title="Food is entirely your choice">
        <Text style={ui.noticeText}>
          {`No compulsory order. Outside food: ${FOOD_RULE_LABEL[p.byo_food]}. Delivery to the venue: ${FOOD_RULE_LABEL[p.outside_delivery]}.`}
          {p.byo_details ? ` ${p.byo_details}` : ""}
        </Text>
      </Notice>

      <Card title="A few things to know">
        {p.house_rules ? <Text style={ui.body}>{p.house_rules}</Text> : null}
        <View style={{ gap: 6 }}>
          {venue.hours.map((h) => (
            <View key={`${h.weekday}-${h.opens}`} style={s.hoursRow}>
              <Text style={ui.muted}>{WEEKDAYS[h.weekday]}</Text>
              <Text style={ui.body}>{`${h.opens}–${h.closes}${h.closes_next_day ? " (next day)" : ""} IST`}</Text>
            </View>
          ))}
        </View>
        <Text style={ui.small}>
          {`Book at least ${p.lead_minutes} minutes ahead · ${durationLabel(p.minimum_minutes)} minimum · ${p.buffer_minutes}-minute cleaning after each booking.`}
        </Text>
        <Text style={ui.small}>
          {`Cancellation (proposed): full refund up to ${p.cancel_cutoff_minutes / 60} h before the start, none after.`}
        </Text>
      </Card>

      {review ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={ui.heading} accessibilityRole="header">Good hours, shared</Text>
          <Text style={s.quote}>{`“${review.body}”`}</Text>
          <Text style={ui.small}>{`★ ${review.rating.toFixed(1)} · Completed stay, ${review.month}`}</Text>
        </View>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  cover: { width: "100%", height: 220, borderRadius: radius.card, backgroundColor: colors.mapSurface },
  coverEmpty: { alignItems: "center", justifyContent: "center", gap: 6 },
  photoCount: {
    position: "absolute", top: 12, right: 12, flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(46, 46, 46, 0.72)", borderRadius: 100, paddingHorizontal: 12, paddingVertical: 6
  },
  photoCountText: { fontFamily: fonts.medium, fontSize: 12, color: colors.surfaceCard },
  logo: {
    position: "absolute", left: 16, bottom: -36, width: 76, height: 76, borderRadius: 20, borderWidth: 4, borderColor: colors.surfaceCanvas,
    backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", overflow: "hidden"
  },
  logoImage: { width: "100%", height: "100%", backgroundColor: colors.surfaceCard },
  logoText: { fontFamily: fonts.display, fontSize: 28, color: colors.surfaceCanvas },
  identity: { gap: 4, marginTop: 16 },
  eyebrow: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.4, color: colors.brandPrimary, textTransform: "uppercase" },
  shortLocation: { flexDirection: "row", alignItems: "center", gap: 6 },
  shortLocationText: { fontFamily: fonts.medium, fontSize: 14, color: colors.textMuted, flex: 1 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  infoIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceCanvas, alignItems: "center", justifyContent: "center" },
  infoLabel: { fontFamily: fonts.medium, fontSize: 11, letterSpacing: 0.3, color: colors.textMuted, textTransform: "uppercase" },
  infoOpen: { color: colors.statusSuccess },
  link: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44 },
  linkText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.brandPrimary },
  amenityGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: spacing.md },
  amenity: { width: "50%", flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 8 },
  chipRow: { gap: spacing.sm },
  partyRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  partyValue: { minWidth: 64, textAlign: "center" },
  tableHead: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  hoursRow: { flexDirection: "row", justifyContent: "space-between" },
  quote: { fontFamily: fonts.display, fontSize: 19, lineHeight: 27, color: colors.textPrimary },
  footerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  footerPrice: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.textPrimary }
});
