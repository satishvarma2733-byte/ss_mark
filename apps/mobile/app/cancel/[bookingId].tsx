// C10 native: cancel a confirmed booking - Figma "A · Customer mobile · Review cancellation" (94:11328). The refund shown
// is the server's preview; confirming sends it back, and if the database clock now gives a different refund (the cutoff
// passed) nothing is cancelled and the new amount is shown. One Idempotency-Key per confirmation, so a retry after a
// lost response cannot cancel or refund twice. "Keep my booking" is the main action; cancelling needs an explicit tick.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ApiError } from "@simply-sit/api-client";
import {
  CUSTOMER_CANCEL_REASONS, CUSTOMER_CANCEL_REASON_LABEL, cancellationPolicySummary, type BookingDetail, type CancelPreview,
  type CustomerCancelReason
} from "@simply-sit/contracts";
import { colors, spacing } from "@simply-sit/design-tokens";
import { Screen } from "../../components/shell";
import { Button, Card, Chip, DetailRow, Divider, MockBadge, Notice, StatusPill, ui } from "../../components/ui";
import { api } from "../../lib/api";
import { formatInrPaise, formatIstDate, formatIstDateTime, formatIstTime } from "../../lib/format";
import { newIdempotencyKey } from "../../lib/session";

type Terms = Pick<CancelPreview, "window" | "refund_paise" | "retained_paise" | "captured_paise" | "terms_change_at">;

export default function CancelScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [version, setVersion] = useState(0);
  const [reason, setReason] = useState<CustomerCancelReason | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "warning" | "error"; text: string } | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    try {
      const [b, p] = await Promise.all([api.getBooking(String(bookingId)), api.cancelPreview(String(bookingId))]);
      setBooking(b);
      setTerms(p);
      setVersion(p.booking_version);
      setCheckedAt(b.server_now);
    } catch (e) {
      setBlocked(true);
      setMessage({
        tone: "error",
        text: e instanceof ApiError && e.code === "INVALID_TRANSITION"
          ? "This booking can no longer be cancelled (it may have started, been checked in or already been cancelled)."
          : e instanceof Error ? e.message : "Could not load the cancellation terms."
      });
    }
  }, [bookingId]);
  useEffect(() => {
    void load();
  }, [load]);

  // Back to this booking's screen: pops to it when it is below in the stack, otherwise replaces this screen with it
  // (for example when the cancel screen was opened from a link on top of another booking).
  const toBooking = () => router.dismissTo({ pathname: "/booking/[id]", params: { id: String(bookingId) } });

  function chooseReason(next: CustomerCancelReason) {
    setReason((current) => (current === next ? null : next));
    setKey(newIdempotencyKey()); // a different request body is a different action
  }

  async function confirm() {
    if (!api || !terms) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.cancelBooking(String(bookingId), {
        expected_version: version, expected_refund_paise: terms.refund_paise, ...(reason ? { reason_code: reason } : {})
      }, key);
      toBooking(); // the booking screen reloads on focus and shows the cancellation and refund state
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.code === "CANCELLATION_CHANGED") {
        const next = e.details as unknown as Terms & { booking_version: number };
        setTerms(next);
        setVersion(next.booking_version);
        setKey(newIdempotencyKey());
        setUnderstood(false); // the amounts changed: confirm the new ones
        setMessage({ tone: "warning", text: "The refund has changed because the cancellation deadline passed. Check the new amount and confirm again." });
      } else if (e instanceof ApiError && (e.code === "STALE_VERSION" || e.code === "INVALID_TRANSITION")) {
        setBlocked(true);
        setMessage({ tone: "error", text: "This booking can no longer be cancelled (it may have started, been checked in or already been cancelled)." });
      } else {
        // Offline or server trouble: retrying reuses the same key, so the cancellation happens at most once.
        setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not cancel. Try again." });
      }
    }
  }

  if (!booking || !terms) {
    return (
      <Screen title="Cancel this booking?" back nav="bookings">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading cancellation terms" />}
        {blocked ? <Button label="Back to booking" variant="secondary" onPress={toBooking} /> : null}
      </Screen>
    );
  }
  const refund = terms.refund_paise;
  const retained = terms.retained_paise;
  const ack = retained > 0
    ? `I understand my table will be released and ${formatInrPaise(retained)} is not refunded.`
    : "I understand my table will be released.";

  return (
    <Screen title="Cancel this booking?" back nav="bookings"
      subtitle={`Review only${checkedAt ? ` · ${formatIstDateTime(checkedAt)} IST` : ""} · Not cancelled`}>
      {booking.venue.is_synthetic ? <MockBadge text="Synthetic demo booking - mock refund, no real money" /> : null}
      <Card>
        <View style={{ gap: 2 }}>
          <Text style={ui.cardTitle}>{booking.venue.name}</Text>
          <Text style={ui.small}>{`${booking.table.label} · ${booking.party_size} ${booking.party_size === 1 ? "guest" : "guests"}`}</Text>
          <Text style={ui.small}>{booking.public_ref}</Text>
        </View>
        <Divider />
        <Text style={ui.body}>{`${formatIstDate(booking.start_at)} · ${formatIstTime(booking.start_at)}–${formatIstTime(booking.end_at)} IST`}</Text>
        <StatusPill tone="success" label="Confirmed · Still reserved" />
      </Card>

      <Notice tone="warning" title="Your table will be released">
        <Text style={ui.noticeText}>Confirming removes your reservation and makes your check-in pass invalid. This cannot be undone.</Text>
      </Notice>

      <Card title="What you’ll get back">
        <DetailRow label="Original payment" value={formatInrPaise(terms.captured_paise)} />
        <DetailRow label="Refundable amount" value={formatInrPaise(refund)} />
        {retained > 0 ? <DetailRow label="Not refunded" value={formatInrPaise(retained)} /> : null}
        <Divider />
        <DetailRow label="Refund to your original payment method" value={formatInrPaise(refund)} strong testID="cancel-refund" />
        {terms.window === "EARLY" && terms.terms_change_at ? (
          <Text style={ui.small}>{`This refund applies if you cancel before ${formatIstDateTime(terms.terms_change_at)} IST.`}</Text>
        ) : null}
        <Text style={ui.small}>A refund request is created when you confirm. It is not an instant credit: it shows as in progress until the payment provider confirms it.</Text>
      </Card>
      {terms.window === "LATE" && refund === 0 ? (
        <Notice tone="warning">The cancellation deadline has passed, so cancelling now gives no refund. The table will be released for others.</Notice>
      ) : null}

      <Card title="Your accepted policy">
        <Text style={ui.body}>{cancellationPolicySummary(booking.policy_snapshot)}</Text>
        <Text style={ui.small}>These are the terms you accepted when you paid. Later changes to the venue’s policy do not replace them.</Text>
      </Card>

      <View style={{ gap: spacing.sm }}>
        <Text style={ui.label}>Reason (optional)</Text>
        <View style={ui.row}>
          {CUSTOMER_CANCEL_REASONS.map((code) => (
            <Chip key={code} label={CUSTOMER_CANCEL_REASON_LABEL[code]} selected={reason === code} onPress={() => chooseReason(code)} testID={`reason-${code}`} />
          ))}
        </View>
      </View>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {blocked ? (
        <Button label="Back to booking" onPress={toBooking} />
      ) : (
        <>
          <View style={s.ackRow}>
            <Switch value={understood} onValueChange={setUnderstood} accessibilityLabel={ack} testID="cancel-understood"
              trackColor={{ true: colors.brandPrimary, false: colors.brandSand }} />
            <Text style={[ui.body, { flex: 1 }]}>{ack}</Text>
          </View>
          <Button label="Keep my booking" onPress={toBooking} disabled={busy} testID="keep-booking" />
          <Button
            label={refund > 0 ? `Confirm cancellation · Refund ${formatInrPaise(refund)}` : "Confirm cancellation · No refund"}
            variant="secondary"
            onPress={() => void confirm()}
            busy={busy}
            disabled={!understood || busy}
            testID="confirm-cancel"
          />
          <Text style={ui.small}>Nothing is cancelled until you confirm.</Text>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  ackRow: { flexDirection: "row", alignItems: "center", gap: spacing.md }
});
