// C05 native - Figma "Customer · Select table and time" (94:10119), review half: the table and time chosen on the venue
// page, the server's quote, the rules being accepted, explicit acceptance, then an atomic hold. Prices come from the
// server's quote; the app sends back the quote ID, policy hash and the total it displayed.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ApiError } from "@simply-sit/api-client";
import type { Quote } from "@simply-sit/contracts";
import { colors, radius, spacing } from "@simply-sit/design-tokens";
import { Screen } from "../components/shell";
import { Button, Card, DetailRow, Divider, MockBadge, Notice, StatusPill, fonts, ui } from "../components/ui";
import { api } from "../lib/api";
import { FOOD_RULE_LABEL, durationLabel, formatInrPaise, formatIstDate, formatIstTime } from "../lib/format";
import { newIdempotencyKey, useSession } from "../lib/session";

const HINT: Record<string, string> = {
  SLOT_UNAVAILABLE: "Someone else just took this table, or it is no longer free. Choose another time.",
  QUOTE_EXPIRED: "The quote expired. Get a fresh quote.",
  QUOTE_CHANGED: "The price or rules changed. Review the new quote.",
  POLICY_NOT_ACCEPTED: "Accept the current terms on the Account tab first.",
  VALIDATION_FAILED: "That time can no longer be booked. Choose another time.",
  OUTSIDE_HOURS: "That time is outside the venue's bookable hours.",
  ACCOUNT_DELETION_PENDING: "Your account has a pending deletion request, so new bookings are paused.",
  NETWORK: "You appear to be offline. Bookings need a connection; nothing was held."
};

const STEPS = ["Table & time", "Payment", "Your pass"];

// Figma step indicator: three numbered steps, the current one in olive.
function Steps({ current }: { current: number }) {
  return (
    <View style={s.steps} accessible accessibilityLabel={`Step ${current + 1} of 3: ${STEPS[current]}`}>
      {STEPS.map((label, i) => (
        <View key={label} style={[s.step, i === current && s.stepCurrent]}>
          <Text style={[s.stepNumber, i === current && s.stepTextCurrent]}>{`0${i + 1}`}</Text>
          <Text style={[s.stepLabel, i === current && s.stepTextCurrent]} numberOfLines={1}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.fact}>
      <Text style={ui.fieldLabel}>{label.toUpperCase()}</Text>
      <Text style={ui.label}>{value}</Text>
    </View>
  );
}

export default function BookScreen() {
  const p = useLocalSearchParams<{
    venueId: string; venueName?: string; resourceId: string; tableLabel?: string; seats?: string; start: string; duration: string; party: string;
  }>();
  const { ready, session } = useSession();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [problem, setProblem] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [holding, setHolding] = useState(false);
  const holdKey = useMemo(() => (quote ? newIdempotencyKey() : null), [quote]);

  const loadQuote = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setProblem(null);
    setAccepted(false);
    try {
      setQuote(await api.createQuote({
        venue_id: String(p.venueId), resource_id: String(p.resourceId), start_at: String(p.start),
        duration_minutes: Number(p.duration), party_size: Number(p.party)
      }));
    } catch (error) {
      setQuote(null);
      const code = error instanceof ApiError ? error.code : "UNEXPECTED";
      setProblem({ code, message: HINT[code] ?? (error instanceof Error ? error.message : "Something went wrong.") });
    } finally {
      setLoading(false);
    }
  }, [p.venueId, p.resourceId, p.start, p.duration, p.party]);

  useEffect(() => {
    if (session) void loadQuote();
  }, [session, loadQuote]);

  async function hold() {
    if (!api || !quote || !holdKey) return;
    setHolding(true);
    setProblem(null);
    try {
      const held = await api.createHold(quote, holdKey);
      router.replace({ pathname: "/checkout/[bookingId]", params: { bookingId: held.booking_id } });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "UNEXPECTED";
      setProblem({ code, message: HINT[code] ?? (error instanceof Error ? error.message : "Something went wrong.") });
    } finally {
      setHolding(false);
    }
  }

  const venueName = p.venueName ?? "Your table";
  const party = Number(p.party);
  const tableLabel = p.tableLabel ?? "Your table";

  if (!ready) {
    return (
      <Screen title="Make it your time" subtitle={venueName} back nav="index">
        <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading" />
      </Screen>
    );
  }
  if (!session) {
    return (
      <Screen title="Make it your time" subtitle={venueName} back nav="index">
        <Steps current={0} />
        <Notice title="Sign in to hold a table">
          <Text style={ui.noticeText}>Browsing is open to everyone; holding a table needs a verified account. Your selection is kept.</Text>
        </Notice>
        <Button label="Sign in on the Account tab" onPress={() => router.push("/account")} testID="go-sign-in" />
      </Screen>
    );
  }

  const policy = quote?.policy_snapshot;
  const price = quote?.price_snapshot;
  const expired = quote ? Date.parse(quote.expires_at) <= Date.now() : false;
  const start = quote?.start_at ?? String(p.start);
  const end = quote?.end_at;
  const cleaningEnd = end && policy ? new Date(Date.parse(end) + policy.buffer_minutes * 60_000).toISOString() : null;

  return (
    <Screen title="Make it your time" subtitle={venueName} back nav="index">
      <Steps current={0} />

      <Card>
        <View style={s.factGrid}>
          <Fact label="Date" value={formatIstDate(start)} />
          <Fact label="Party size" value={`${party} ${party === 1 ? "guest" : "guests"}`} />
          <Fact label="Start time · IST" value={formatIstTime(start)} />
          <Fact label="Duration" value={durationLabel(Number(p.duration))} />
        </View>
        <Button label="Change table or time" variant="secondary" onPress={() => router.back()} />
      </Card>

      <View style={{ gap: spacing.md }}>
        <View style={{ gap: 2 }}>
          <Text style={ui.heading} accessibilityRole="header">Your table</Text>
          <Text style={ui.small}>Prices are per table, not per person.</Text>
        </View>
        <View style={s.table}>
          <View style={s.tableHead}>
            <Text style={[ui.label, { flex: 1 }]}>{tableLabel}</Text>
            {price ? <Text style={ui.label}>{`${formatInrPaise(price.hourly_paise)}/hr`}</Text> : null}
          </View>
          {p.seats ? <Text style={ui.small}>{`Seats up to ${p.seats} · one table, not shared`}</Text> : null}
          <StatusPill tone="success" label={quote ? "Selected · Available" : loading ? "Checking availability" : "Selected"} />
        </View>
        {quote && end ? (
          <Notice title={`Your table, ${formatIstTime(start)}–${formatIstTime(end)}`}>
            <Text style={ui.noticeText}>
              {cleaningEnd && policy && policy.buffer_minutes > 0
                ? `Cleaning follows from ${formatIstTime(end)}–${formatIstTime(cleaningEnd)}, so the next guest finds it ready.`
                : "The table is yours for the whole slot."}
            </Text>
          </Notice>
        ) : null}
      </View>

      {loading ? <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Getting a quote" /> : null}
      {problem ? (
        <Notice tone="error" title="This table could not be held">
          <Text style={ui.noticeText} testID="book-problem">{problem.message}</Text>
          {problem.code === "QUOTE_EXPIRED" || problem.code === "QUOTE_CHANGED" || problem.code === "NETWORK" ? (
            <Button label="Get a fresh quote" onPress={() => void loadQuote()} />
          ) : (
            <Button label="Choose another time" variant="secondary" onPress={() => router.back()} />
          )}
        </Notice>
      ) : null}

      {quote && policy && price ? (
        <>
          <Card>
            {price.synthetic ? <MockBadge text="Sandbox pricing - no real charge" /> : null}
            <DetailRow label={`${tableLabel} · ${durationLabel(price.duration_minutes)}`} value={formatInrPaise(price.base_paise)} />
            <DetailRow label="Platform fee" value={formatInrPaise(price.service_fee_paise)} />
            {price.discount_paise > 0 ? <DetailRow label="Discount" value={`-${formatInrPaise(price.discount_paise)}`} /> : null}
            <DetailRow label="Taxes" value="Not configured" />
            <Divider />
            <DetailRow label={`Total · ${party} ${party === 1 ? "guest" : "guests"}`} value={formatInrPaise(price.total_paise)} strong testID="quote-total" />
          </Card>

          <Card title="Rules you are accepting">
            <Text style={ui.body}>{`Outside food: ${FOOD_RULE_LABEL[policy.byo_food]}. ${policy.byo_details}`}</Text>
            <Text style={ui.body}>{`Outside delivery: ${FOOD_RULE_LABEL[policy.outside_delivery]}. Venue food is optional.`}</Text>
            {policy.house_rules ? <Text style={ui.body}>{policy.house_rules}</Text> : null}
            <Text style={ui.body}>
              {`Cancellation: full refund at least ${policy.cancel_cutoff_minutes / 60} h before the start; none after. Arrive within ${policy.grace_minutes} min of the start.`}
            </Text>
            <View style={s.acceptRow}>
              <Text style={[ui.body, { flex: 1 }]} nativeID="accept-label">I accept these rules and the cancellation terms</Text>
              <Switch value={accepted} onValueChange={setAccepted} accessibilityLabelledBy="accept-label" accessibilityLabel="Accept rules"
                testID="accept-rules" trackColor={{ true: colors.brandPrimary, false: colors.brandSand }} />
            </View>
          </Card>

          {expired ? (
            <Button label="Quote expired - get a fresh quote" variant="secondary" onPress={() => void loadQuote()} />
          ) : (
            <Button label="Hold table and continue to payment" onPress={() => void hold()} disabled={!accepted} busy={holding} testID="hold-table" />
          )}
          <View style={s.footnote}>
            <Ionicons name="time-outline" size={14} color={colors.textMuted} accessible={false} />
            <Text style={[ui.small, { flex: 1 }]}>
              {`Availability is rechecked before a ${policy.hold_minutes}-minute hold begins. Nothing is charged until you pay.`}
            </Text>
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  steps: { flexDirection: "row", gap: spacing.sm },
  step: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 10, borderRadius: radius.button,
    borderWidth: 1, borderColor: colors.brandSand, backgroundColor: colors.surfaceCard
  },
  stepCurrent: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  stepNumber: { fontFamily: fonts.semibold, fontSize: 11, color: colors.textMuted },
  stepLabel: { fontFamily: fonts.medium, fontSize: 11, color: colors.textMuted, flexShrink: 1 },
  stepTextCurrent: { color: colors.surfaceCard },
  factGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: spacing.base },
  fact: { width: "50%", gap: 4, paddingRight: spacing.sm },
  table: {
    gap: 6, padding: spacing.base, borderRadius: radius.card, borderWidth: 2, borderColor: colors.brandPrimary, backgroundColor: colors.surfaceCard
  },
  tableHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  acceptRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  footnote: { flexDirection: "row", gap: 6, alignItems: "flex-start" }
});
