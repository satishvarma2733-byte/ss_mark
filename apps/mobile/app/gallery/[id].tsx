// Native venue gallery - Figma "Customer · Venue gallery" (94:17490): every approved photo, large, each with its
// position and the description the venue gave, then a way back to the venue.
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { VenueDetail } from "@simply-sit/contracts";
import { colors, radius, spacing } from "@simply-sit/design-tokens";
import { Screen } from "../../components/shell";
import { Button, Notice, ui } from "../../components/ui";
import { api, apiUrl } from "../../lib/api";

const two = (n: number) => String(n).padStart(2, "0");

export default function GalleryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    api.getVenue(String(id)).then(setVenue).catch(() => setError("These photos could not be loaded."));
  }, [id]);

  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: "/venue/[id]", params: { id: String(id) } }));

  return (
    <Screen title="Venue gallery" subtitle={venue ? `${venue.locality} · ${venue.name}` : undefined} back nav="index">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!venue && !error ? <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading photos" /> : null}
      {venue && venue.photos.length === 0 ? <Notice title="No photos yet">This venue has not added approved photos.</Notice> : null}
      {venue && apiUrl
        ? venue.photos.map((photo, i) => (
            <View key={photo.id} style={{ gap: spacing.sm }} testID="gallery-photo">
              <Image source={{ uri: `${apiUrl}/api/v1/media/${photo.id}` }} style={s.photo} resizeMode="cover"
                accessible accessibilityLabel={photo.alt_text} />
              <Text style={ui.small}>{`${two(i + 1)} / ${two(venue.photos.length)} · ${photo.alt_text}`}</Text>
            </View>
          ))
        : null}
      <Button label="Back to venue details" variant="secondary" onPress={back} testID="gallery-back" />
    </Screen>
  );
}

const s = StyleSheet.create({
  photo: { width: "100%", height: 240, borderRadius: radius.card, backgroundColor: colors.mapSurface }
});
