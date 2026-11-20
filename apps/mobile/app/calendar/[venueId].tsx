// Customer date and time calendar - Figma "Customer · Date and time calendar" (94:17537). A month view of the venue's
// booking window (policy max_horizon_days, IST), length and guests, and the free start times for the chosen day
// (GET /venues/{id}/availability). "Use ..." returns the choice to the venue page, where the table is picked.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { VenueAvailability, VenueDetail } from "@simply-sit/contracts";
import { colors, radius, spacing } from "@simply-sit/design-tokens";
import { Screen } from "../../components/shell";
import { Button, Card, Chip, Notice, fonts, ui } from "../../components/ui";
import { api } from "../../lib/api";
import { durationLabel, formatIstDate, formatIstTime, istDateKey } from "../../lib/format";

const WEEK = ["M", "T", "W", "T", "F", "S", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const keyOf = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export default function CalendarScreen() {
  const p = useLocalSearchParams<{ venueId: string; date?: string; duration?: string; party?: string }>();
  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [error, setError] = useState(false);
  const today = istDateKey(0);
  const [date, setDate] = useState(p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.date >= today ? p.date : today);
  const [duration, setDuration] = useState(Number(p.duration) || 60);
  const [party, setParty] = useState(Number(p.party) || 2);
  const [month, setMonth] = useState(() => ({ y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) - 1 }));
  const [slots, setSlots] = useState<VenueAvailability | null>(null);
  const [slotsError, setSlotsError] = useState(false);

  useEffect(() => {
    if (!api) return;
    api.getVenue(String(p.venueId)).then(setVenue).catch(() => setError(true));
  }, [p.venueId]);

  const policy = venue?.policy;
  const last = istDateKey(Math.max(0, (policy?.max_horizon_days ?? 30) - 1));
  const durations = useMemo(() => {
    const out: number[] = [];
    if (policy) for (let m = policy.minimum_minutes; m <= policy.maximum_minutes; m += policy.increment_minutes) if (m % 30 === 0) out.push(m);
    return out;
  }, [policy]);
  const length = durations.includes(duration) ? duration : durations[0] ?? 60;

  useEffect(() => {
    let live = true;
    setSlots(null);
    setSlotsError(false);
    if (!api || !venue) return;
    api.getAvailability(venue.id, { date, duration_minutes: length, party_size: party })
      .then((a) => live && setSlots(a)).catch(() => live && setSlotsError(true));
    return () => {
      live = false;
    };
  }, [venue, date, length, party]);

  if (error || !venue || !policy) {
    return (
      <Screen title="Date and time" back nav="index">
        {error ? <Notice tone="error">This venue is not available.</Notice> : <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading" />}
      </Screen>
    );
  }

  // Monday-first grid for the shown month.
  const firstDow = (new Date(Date.UTC(month.y, month.m, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const canPrev = keyOf(month.y, month.m, 1) > today;
  const canNext = keyOf(month.y, month.m, days) < last;
  const shift = (by: number) => setMonth(({ y, m }) => ({ y: m + by < 0 ? y - 1 : m + by > 11 ? y + 1 : y, m: (m + by + 12) % 12 }));
  const starts = [...new Set((slots?.tables ?? []).flatMap((t) => t.starts))].sort();
  const selectedLabel = formatIstDate(`${date}T12:00:00+05:30`);
  const hours = venue.hours.length ? `${venue.hours[0]!.opens}–${venue.hours[0]!.closes}` : null;

  return (
    <Screen title="Date and time" subtitle={`${venue.name} · Asia/Kolkata`} back nav="index">
      <Card>
        <View style={s.monthHead}>
          <Pressable onPress={() => shift(-1)} disabled={!canPrev} accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={8} style={[s.nav, !canPrev && s.disabled]}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} accessible={false} />
          </Pressable>
          <Text style={ui.cardTitle} accessibilityRole="header">{`${MONTHS[month.m]} ${month.y}`}</Text>
          <Pressable onPress={() => shift(1)} disabled={!canNext} accessibilityRole="button" accessibilityLabel="Next month" hitSlop={8} style={[s.nav, !canNext && s.disabled]}>
            <Ionicons name="chevron-forward" size={20} color={colors.textPrimary} accessible={false} />
          </Pressable>
        </View>
        <View style={s.grid}>
          {WEEK.map((w, i) => <Text key={`h${i}`} style={[s.cell, s.weekday]}>{w}</Text>)}
          {cells.map((d, i) => {
            if (d === null) return <View key={`e${i}`} style={s.cell} />;
            const k = keyOf(month.y, month.m, d);
            const open = k >= today && k <= last;
            const sel = k === date;
            return (
              <Pressable key={k} onPress={() => setDate(k)} disabled={!open} accessibilityRole="button"
                accessibilityState={{ selected: sel, disabled: !open }} accessibilityLabel={formatIstDate(`${k}T12:00:00+05:30`)}
                style={[s.cell, s.day, sel && s.daySel, k === today && !sel && s.dayToday]} testID={`cal-${k}`}>
                <Text style={[s.dayText, sel && s.dayTextSel, !open && s.dayTextOff]}>{d}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={s.selected}>{`Selected · ${selectedLabel}`}</Text>
      </Card>

      <Card>
        <Text style={ui.fieldLabel}>DURATION</Text>
        <View style={ui.row}>
          {durations.map((m) => <Chip key={m} label={durationLabel(m)} selected={m === length} onPress={() => setDuration(m)} />)}
        </View>
        <Text style={ui.fieldLabel}>GUESTS</Text>
        <View style={s.stepper}>
          <Button label="-" variant="secondary" onPress={() => setParty((n) => Math.max(1, n - 1))} hint="Fewer guests" />
          <Text style={[ui.body, { minWidth: 72, textAlign: "center" }]} accessibilityLiveRegion="polite">{`${party} ${party === 1 ? "guest" : "guests"}`}</Text>
          <Button label="+" variant="secondary" onPress={() => setParty((n) => Math.min(20, n + 1))} hint="More guests" />
        </View>
        <Text style={ui.fieldLabel}>FREE START TIMES · IST</Text>
        {slotsError ? <Text style={ui.small}>Times could not be loaded. Check your connection.</Text>
          : !slots ? <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading times" />
          : starts.length === 0 ? <Text style={ui.small} testID="cal-none">{`No table is free for ${party} on ${selectedLabel} for ${durationLabel(length)}.`}</Text>
          : <Text style={ui.body} testID="cal-starts">{starts.slice(0, 12).map((t) => formatIstTime(t)).join(" · ")}{starts.length > 12 ? ` · +${starts.length - 12} more` : ""}</Text>}
        <Text style={ui.small}>
          {`${hours ? `Usually ${hours} · ` : ""}${durationLabel(policy.minimum_minutes)} minimum · ${policy.lead_minutes}-minute lead time · ${policy.buffer_minutes}-minute cleaning`}
        </Text>
      </Card>

      <Button label={`Use ${selectedLabel} · ${durationLabel(length)} · ${party} ${party === 1 ? "guest" : "guests"}`} testID="cal-use"
        onPress={() => router.dismissTo({ pathname: "/venue/[id]", params: { id: venue.id, date, duration: String(length), party: String(party) } })} />
    </Screen>
  );
}

const s = StyleSheet.create({
  monthHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  nav: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.3 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, height: 44, alignItems: "center", justifyContent: "center" },
  weekday: { fontFamily: fonts.semibold, fontSize: 12, color: colors.textMuted, textAlign: "center", lineHeight: 44 },
  day: { borderRadius: radius.button },
  daySel: { backgroundColor: colors.brandPrimary },
  dayToday: { borderWidth: 1, borderColor: colors.brandPrimary },
  dayText: { fontFamily: fonts.medium, fontSize: 15, color: colors.textPrimary },
  dayTextSel: { color: colors.surfaceCard, fontFamily: fonts.semibold },
  dayTextOff: { color: colors.textMuted, opacity: 0.45 },
  selected: { fontFamily: fonts.semibold, fontSize: 14, color: colors.brandPrimary },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.sm }
});
