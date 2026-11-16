// C03 location - Figma "A · Customer mobile · Manual location". Browse by pilot area with no permission at all;
// device location is optional, asked only after a tap, and rounded to about 1 km before it leaves this screen.
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Location from "expo-location";
import { PILOT_AREAS, coarseCoordinate } from "@simply-sit/contracts";
import { colors } from "@simply-sit/design-tokens";
import { Button, Card, Divider, Field, Notice, fonts, ui } from "../components/ui";
import { Screen } from "../components/shell";

export default function LocationScreen() {
  const params = useLocalSearchParams<{ area?: string }>();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>(params.area ?? PILOT_AREAS[0].code);
  const [permission, setPermission] = useState<"unknown" | "denied" | "blocked" | "granted">("unknown");
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void Location.getForegroundPermissionsAsync()
      .then((p) => setPermission(p.status === "granted" ? "granted" : p.status === "denied" ? (p.canAskAgain ? "denied" : "blocked") : "unknown"))
      .catch(() => setPermission("unknown"));
  }, []);

  const needle = query.trim().toLowerCase();
  const areas = useMemo(() => PILOT_AREAS.filter((a) => !needle || a.label.toLowerCase().includes(needle)), [needle]);
  const chosen = PILOT_AREAS.find((a) => a.code === selected) ?? PILOT_AREAS[0];

  async function tryDevice() {
    setLocating(true);
    setNote(null);
    try {
      const p = await Location.requestForegroundPermissionsAsync();
      if (p.status !== "granted") {
        setPermission(p.canAskAgain ? "denied" : "blocked");
        return;
      }
      setPermission("granted");
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      router.navigate({
        pathname: "/",
        params: { lat: String(coarseCoordinate(position.coords.latitude)), lng: String(coarseCoordinate(position.coords.longitude)) }
      });
    } catch {
      setNote("We could not get your location. Choose an area instead.");
    } finally {
      setLocating(false);
    }
  }

  return (
    <Screen title="Choose an area" subtitle="Explore Bengaluru" back nav="index">
      <Text style={ui.display}>Good hours, closer to you.</Text>
      <Field label="Search area or landmark" hint="Search manually; precise location is optional.">
        <TextInput style={ui.input} value={query} onChangeText={setQuery} placeholder="e.g. Indiranagar" placeholderTextColor={colors.textMuted}
          accessibilityLabel="Search area or landmark" autoCapitalize="words" />
      </Field>
      {permission === "denied" || permission === "blocked" ? (
        <Notice tone="warning" title="Device location is turned off">
          {permission === "blocked"
            ? "Location is off for Simply Sit. You can still browse by area; no permission is required. To use location, allow it in system settings."
            : "Location was not shared. You can still browse by area; no permission is required."}
        </Notice>
      ) : null}
      {note ? <Notice tone="error">{note}</Notice> : null}
      <Card title={needle ? "Matching areas" : "Suggested areas"}>
        {areas.length === 0 ? <Text style={ui.muted}>No pilot area matches “{query}”. Try another name.</Text> : null}
        {areas.map((a, i) => (
          <View key={a.code} style={styles.areaBlock}>
            {i > 0 ? <Divider /> : null}
            <Pressable
              onPress={() => setSelected(a.code)}
              accessibilityRole="radio"
              accessibilityState={{ checked: a.code === selected }}
              accessibilityLabel={`${a.label}, Bengaluru`}
              style={[styles.areaRow, a.code === selected && styles.areaRowSelected]}
            >
              <Text style={[styles.areaName, a.code === selected && styles.areaNameSelected]}>{a.label}</Text>
              <Text style={styles.areaCity}>{a.code === selected ? "Selected ✓" : "Bengaluru →"}</Text>
            </Pressable>
          </View>
        ))}
      </Card>
      <Button label={`Use ${chosen.label}`} onPress={() => router.navigate({ pathname: "/", params: { area: chosen.code } })} testID="use-area" />
      <Button label={locating ? "Locating…" : "Try device location again"} variant="secondary" busy={locating} onPress={() => void tryDevice()}
        disabled={permission === "blocked"} />
      <Text style={ui.hint}>
        If you choose device location, we round it to about 1 km and use it to suggest nearby spaces, not to confirm a table.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  areaBlock: { gap: 16 },
  areaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44, gap: 16 },
  areaRowSelected: {},
  areaName: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted },
  areaNameSelected: { fontFamily: fonts.semibold, color: colors.textPrimary },
  areaCity: { fontFamily: fonts.medium, fontSize: 14, color: colors.textPrimary }
});
