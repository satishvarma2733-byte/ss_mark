// C12 native - Figma "A · Customer mobile · Completed-stay review". One review per completed booking; reviews are
// checked by Simply Sit before they appear on the venue. The quick "worked well / could be better" choices are added to
// the review text, which is the only free-text field the API stores.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ApiError } from "@simply-sit/api-client";
import type { BookingDetail } from "@simply-sit/contracts";
import { colors } from "@simply-sit/design-tokens";
import { Button, Card, Chip, Field, Notice, StatusPill, fonts, ui } from "../../components/ui";
import { Screen } from "../../components/shell";
import { BookingIdentity } from "../../components/booking";
import { api } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/session";

const MODERATION: Record<string, string> = {
  PENDING: "Thanks. Your review is waiting for a quick check before it appears.",
  PUBLISHED: "Your review is published on the venue page.",
  HIDDEN: "Your review was not published because it did not meet the review guidelines."
};
const RATING_WORD = ["", "Poor", "Fair", "Okay", "Good", "Excellent"];
const WORKED = ["Wi-Fi", "Cleanliness", "Staff welcome", "Noise level", "Table comfort"];
const BETTER = ["Power access", "Noise level", "Check-in", "Accuracy"];
const LIMIT = 1000;

export default function ReviewScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [rating, setRating] = useState(0);
  const [worked, setWorked] = useState<string[]>([]);
  const [better, setBetter] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());

  const load = useCallback(async () => {
    if (!api) return;
    try {
      setBooking(await api.getBooking(String(bookingId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the booking.");
    }
  }, [bookingId]);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (list: string[], set: (v: string[]) => void, item: string) => set(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  async function send() {
    if (!api) return;
    setBusy(true);
    setError(null);
    const parts = [
      worked.length ? `Worked well: ${worked.join(", ")}.` : "",
      better.length ? `Could be better: ${better.join(", ")}.` : "",
      body.trim()
    ].filter(Boolean);
    try {
      await api.createReview(String(bookingId), rating, parts.join("\n") || undefined, key.current);
      key.current = newIdempotencyKey();
      await load();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "NETWORK")) key.current = newIdempotencyKey();
      setError(e instanceof Error ? e.message : "Could not send the review.");
    } finally {
      setBusy(false);
    }
  }

  if (!booking) {
    return (
      <Screen title="Rate your stay" back nav="bookings">
        {error ? <Notice tone="error">{error}</Notice> : <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading" />}
      </Screen>
    );
  }

  return (
    <Screen title="Rate your stay" subtitle={booking.venue.name} back nav="bookings">
      <BookingIdentity booking={booking}>
        <StatusPill label={booking.status === "COMPLETED" ? (booking.review ? "Completed · Reviewed" : "Completed · Eligible to review") : "Not completed yet"} tone="sage" />
      </BookingIdentity>
      {booking.review ? (
        <Card title="Your review">
          <Text style={styles.stars} testID="review-status" accessibilityLabel={`${booking.review.rating} of 5`}>
            {`${"★ ".repeat(booking.review.rating)}${"☆ ".repeat(5 - booking.review.rating)}`.trim()}
          </Text>
          <Text style={[ui.small, styles.center]}>{`${booking.review.rating} of 5`}</Text>
          {booking.review.body ? <Text style={ui.body}>{booking.review.body}</Text> : null}
          <Text style={ui.muted}>{MODERATION[booking.review.moderation_status]}</Text>
          <Button label="Back to booking" variant="secondary" onPress={() => router.back()} />
        </Card>
      ) : booking.status !== "COMPLETED" ? (
        <Notice>You can review this visit after it is completed.</Notice>
      ) : (
        <>
          <Card title="Rate your experience">
            <View style={styles.starRow} accessibilityRole="radiogroup" accessibilityLabel="Rating from 1 to 5">
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} onPress={() => setRating(n)} accessibilityRole="radio" accessibilityState={{ checked: rating === n }}
                  accessibilityLabel={`${n} of 5`} testID={`rating-${n}`} style={styles.starButton}>
                  <Text style={styles.star}>{n <= rating ? "★" : "☆"}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[ui.small, styles.center]}>{rating ? `${rating} of 5 · ${RATING_WORD[rating]}` : "Tap a star to rate"}</Text>
            <Text style={styles.question}>What worked well?</Text>
            <View style={ui.row}>
              {WORKED.map((t) => (
                <Chip key={t} label={t} selected={worked.includes(t)} onPress={() => toggle(worked, setWorked, t)} />
              ))}
            </View>
            <Text style={styles.question}>What could be better?</Text>
            <View style={ui.row}>
              {BETTER.map((t) => (
                <Chip key={t} label={t} selected={better.includes(t)} onPress={() => toggle(better, setBetter, t)} />
              ))}
            </View>
            <Field label="Tell the venue more" hint={`${body.length} / ${LIMIT.toLocaleString("en-IN")} characters`}>
              <TextInput value={body} onChangeText={setBody} placeholder="Optional" placeholderTextColor={colors.textMuted} multiline maxLength={LIMIT}
                accessibilityLabel="Your review" testID="review-body" style={[ui.input, styles.multiline]} />
            </Field>
          </Card>
          <Notice title="Useful, fair feedback">
            Describe your own stay. Don’t include phone numbers, payment details, private information or allegations about other guests. Reviews may be
            moderated under our review policy.
          </Notice>
          <View style={styles.checkRow}>
            <Switch value={confirmed} onValueChange={setConfirmed} accessibilityLabel="I confirm this reflects my completed stay"
              trackColor={{ true: colors.brandSage, false: colors.brandSand }} thumbColor={confirmed ? colors.brandPrimary : colors.surfaceCard} />
            <Text style={[ui.small, styles.flex, styles.dark]}>I confirm this reflects my completed stay.</Text>
          </View>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button label="Submit review" onPress={() => void send()} busy={busy} disabled={busy || rating === 0 || !confirmed} testID="review-send" />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: "center" },
  flex: { flex: 1 },
  dark: { color: colors.textPrimary },
  starRow: { flexDirection: "row", justifyContent: "center", gap: 4 },
  starButton: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  star: { fontSize: 34, color: colors.brandPrimary },
  stars: { fontSize: 28, color: colors.brandPrimary, textAlign: "center" },
  question: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 20, color: colors.textPrimary },
  multiline: { minHeight: 110, textAlignVertical: "top" },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 8 }
});
