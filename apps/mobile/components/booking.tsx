// Figma "Venue identity" panel used across the booking screens: a 64 x 70 venue photo (the venue's first approved
// photo, served by the API), venue name, table and party, reference, then the date line and a status pill.
import { useEffect, useState, type ReactNode } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import type { BookingDetail } from "@simply-sit/contracts";
import { colors, radius } from "@simply-sit/design-tokens";
import { api, apiUrl } from "../lib/api";
import { formatIstDate, formatIstTime } from "../lib/format";
import { Card, Divider, fonts, ui } from "./ui";

// The venue's first approved photo, or null (shown as a plain tile). Public data; failures are silent.
export function useVenuePhoto(venueId: string | undefined) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    if (!api || !apiUrl || !venueId) return;
    let live = true;
    void api.getVenue(venueId).then(
      (v) => live && setUri(v.photos[0] ? `${apiUrl}/api/v1/media/${v.photos[0].id}` : null),
      () => undefined
    );
    return () => {
      live = false;
    };
  }, [venueId]);
  return uri;
}

export function bookingWhen(b: Pick<BookingDetail, "start_at" | "end_at">) {
  return `${formatIstDate(b.start_at)} · ${formatIstTime(b.start_at)}–${formatIstTime(b.end_at)} IST`;
}

export function BookingIdentity({ booking, children }: { booking: BookingDetail; children?: ReactNode }) {
  const photo = useVenuePhoto(booking.venue.id);
  const guests = `${booking.party_size} ${booking.party_size === 1 ? "guest" : "guests"}`;
  return (
    <Card>
      <View style={styles.identity}>
        {photo ? <Image source={{ uri: photo }} style={styles.photo} accessible={false} /> : <View style={styles.photo} />}
        <View style={styles.text}>
          <Text style={styles.venue}>{booking.venue.name}</Text>
          <Text style={ui.small}>
            {booking.table.label} · {guests}
          </Text>
          <Text style={ui.hint} testID="booking-ref">
            {booking.public_ref}
          </Text>
        </View>
      </View>
      <Divider />
      <Text style={styles.when}>{bookingWhen(booking)}</Text>
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  photo: { width: 64, height: 70, borderRadius: radius.button, backgroundColor: colors.mapSurface },
  text: { flex: 1, gap: 4 },
  venue: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.textPrimary },
  when: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: colors.textPrimary }
});
