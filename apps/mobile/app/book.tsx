// C05 native: server quote, the rules being accepted, explicit acceptance, then an atomic hold. Prices shown here
// come from the server's quote; the app sends back the quote ID, policy hash and the total it displayed.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Switch, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { ApiError } from "@simply-sit/api-client";
import type { Quote } from "@simply-sit/contracts";
import { colors } from "@simply-sit/design-tokens";
import { Button, Card, MockBadge, Notice, ui } from "../components/ui";
import { api } from "../lib/api";
import { FOOD_RULE_LABEL, formatInrPaise, formatIstDateTime, formatIstTime } from "../lib/format";
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

export default function BookScreen() {
  const p = useLocalSearchParams<{ venueId: string; venueName?: string; resourceId: string; start: string; duration: string; party: string }>();
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

  if (!ready) return <ActivityIndicator style={{ marginTop: 48 }} color={colors.brandPrimary} />;
  if (!session) {
    return (
      <View style={ui.screen}>
        <Stack.Screen options={{ title: "Sign in to book" }} />
        <Text style={ui.title}>Sign in to hold a table</Text>
        <Text style={ui.muted}>Browsing is open to everyone; holding a table needs a verified account. Your selection is kept.</Text>
        <Button label="Sign in on the Account tab" onPress={() => router.push("/account")} testID="go-sign-in" />
      </View>
    );
  }
  const policy = quote?.policy_snapshot;
  const expired = quote ? Date.parse(quote.expires_at) <= Date.now() : false;

  return (
    <ScrollView contentContainerStyle={ui.screen}>
      <Stack.Screen options={{ title: "Review and hold" }} />
      <Text style={ui.title}>{p.venueName ?? "Review and hold"}</Text>
      {loading ? <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Getting a quote" /> : null}
      {problem ? (
        <Notice tone="error">
          <Text style={[ui.body, { color: colors.statusError }]} testID="book-problem">
            {problem.message}
          </Text>
          {problem.code === "QUOTE_EXPIRED" || problem.code === "QUOTE_CHANGED" || problem.code === "NETWORK" ? (
            <Button label="Get a fresh quote" onPress={() => void loadQuote()} />
          ) : (
            <Button label="Choose another time" variant="secondary" onPress={() => router.back()} />
          )}
        </Notice>
      ) : null}
      {quote && policy ? (
        <Card>
          {quote.price_snapshot.synthetic ? <MockBadge text="Sandbox pricing - no real charge" /> : null}
          <Text style={ui.heading}>
            {formatIstDateTime(quote.start_at)} - {formatIstTime(quote.end_at)} IST
          </Text>
          <Text style={ui.small}>
            {quote.party_size} {quote.party_size === 1 ? "person" : "people"} · one table, not shared
          </Text>
          <Text style={ui.body}>Table time: {formatInrPaise(quote.price_snapshot.base_paise)}</Text>
          <Text style={ui.body}>Service fee: {formatInrPaise(quote.price_snapshot.service_fee_paise)}</Text>
          <Text style={ui.small}>Taxes: not configured (no tax rate approved)</Text>
          <Text style={ui.price} testID="quote-total">
            Total {formatInrPaise(quote.price_snapshot.total_paise)}
          </Text>
          <Text style={ui.heading}>Rules you are accepting</Text>
          <Text style={ui.body}>
            Outside food: {FOOD_RULE_LABEL[policy.byo_food]}. {policy.byo_details}
          </Text>
          <Text style={ui.body}>Outside delivery: {FOOD_RULE_LABEL[policy.outside_delivery]}. Venue food is optional.</Text>
          <Text style={ui.body}>{policy.house_rules}</Text>
          <Text style={ui.body}>
            Cancellation: full refund at least {policy.cancel_cutoff_minutes / 60} h before the start; none after. Arrive within {policy.grace_minutes} min of
            the start.
          </Text>
          <View style={[ui.row, { justifyContent: "space-between" }]}>
            <Text style={[ui.body, { flex: 1 }]} nativeID="accept-label">
              I accept these rules and the cancellation terms
            </Text>
            <Switch value={accepted} onValueChange={setAccepted} accessibilityLabelledBy="accept-label" accessibilityLabel="Accept rules"
              testID="accept-rules" trackColor={{ true: colors.brandPrimary, false: colors.brandSand }} />
          </View>
          {expired ? (
            <Button label="Quote expired - get a fresh quote" variant="secondary" onPress={() => void loadQuote()} />
          ) : (
            <Button label={`Hold this table for ${policy.hold_minutes} minutes`} onPress={() => void hold()} disabled={!accepted} busy={holding}
              testID="hold-table" />
          )}
          <Text style={ui.small}>Nothing is charged until you pay on the next screen.</Text>
        </Card>
      ) : null}
    </ScrollView>
  );
}
