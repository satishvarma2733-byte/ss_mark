// Customer advanced filters - Figma "Customer · Advanced filters" (94:17429). Venue types, atmosphere and facilities,
// sent to GET /venues as category, environment_tags and amenities (server-side filters). The current choices come in
// as comma-separated params and go back to Discover the same way. Budget and food-rule filters in the frame are not
// built: the search API does not filter on them yet. Accessibility claims are shown only where the venue listed them.
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AMENITY_CODES, CATEGORY_CODES, ENVIRONMENT_TAGS } from "@simply-sit/contracts";
import { spacing } from "@simply-sit/design-tokens";
import { Screen } from "../components/shell";
import { Button, Card, Chip, ui } from "../components/ui";
import { tagLabel } from "../lib/labels";

const list = (value: string | undefined) => new Set((value ?? "").split(",").filter(Boolean));
const ACCESS = new Set(["ACCESSIBLE_ENTRANCE", "ACCESSIBLE_RESTROOM"]);

function Toggles({ title, codes, chosen, onToggle, testPrefix }: {
  title: string; codes: readonly string[]; chosen: Set<string>; onToggle: (code: string) => void; testPrefix: string;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={ui.fieldLabel}>{title.toUpperCase()}</Text>
      <View style={ui.row}>
        {codes.map((c) => (
          <Chip key={c} label={`${chosen.has(c) ? "✓ " : ""}${tagLabel(c)}`} selected={chosen.has(c)} onPress={() => onToggle(c)} testID={`${testPrefix}-${c}`} />
        ))}
      </View>
    </View>
  );
}

export default function FiltersScreen() {
  const p = useLocalSearchParams<{ category?: string; environment?: string; amenities?: string }>();
  const [category, setCategory] = useState(() => list(p.category));
  const [environment, setEnvironment] = useState(() => list(p.environment));
  const [amenities, setAmenities] = useState(() => list(p.amenities));
  const flip = (set: Set<string>, update: (s: Set<string>) => void) => (code: string) => {
    const next = new Set(set);
    if (next.has(code)) next.delete(code); else next.add(code);
    update(next);
  };
  const count = category.size + environment.size + amenities.size;
  const apply = (c: Set<string>, e: Set<string>, a: Set<string>) =>
    router.navigate({ pathname: "/", params: { category: [...c].join(","), environment: [...e].join(","), amenities: [...a].join(","), filtersAt: String(Date.now()) } });

  return (
    <Screen title="Advanced filters" subtitle="Bengaluru · Asia/Kolkata" back nav="index">
      <Card title="Make room for what matters">
        <Toggles title="Venue type" codes={CATEGORY_CODES} chosen={category} onToggle={flip(category, setCategory)} testPrefix="filter-category" />
        <Toggles title="Atmosphere" codes={ENVIRONMENT_TAGS} chosen={environment} onToggle={flip(environment, setEnvironment)} testPrefix="filter-environment" />
        <Toggles title="Facilities" codes={AMENITY_CODES.filter((c) => !ACCESS.has(c))} chosen={amenities} onToggle={flip(amenities, setAmenities)} testPrefix="filter-amenity" />
      </Card>
      <Card title="Access">
        <Toggles title="Accessibility" codes={[...ACCESS]} chosen={amenities} onToggle={flip(amenities, setAmenities)} testPrefix="filter-amenity" />
        <Text style={ui.small}>Accessibility details are listed by each venue; unverified ones are marked on the venue page.</Text>
        <Text style={ui.small}>No venue requires a food order. Outside food and delivery rules are shown on each venue.</Text>
      </Card>
      <View style={s.actions}>
        <Button label={count > 0 ? `Apply ${count} ${count === 1 ? "filter" : "filters"}` : "Show all spaces"} onPress={() => apply(category, environment, amenities)} testID="apply-filters" />
        <Button label="Reset filters" variant="secondary" disabled={count === 0}
          onPress={() => { setCategory(new Set()); setEnvironment(new Set()); setAmenities(new Set()); }} testID="reset-filters" />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  actions: { gap: spacing.md }
});
