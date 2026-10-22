import type { DietTag } from "@smart-cart/contracts";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAssist } from "../lib/assist-store";
import { colors } from "../lib/theme";

const PREFS: { tag: DietTag; label: string }[] = [
  { tag: "veg", label: "Veg only" },
  { tag: "jain", label: "Jain" },
];

/** The shopper's diet preference. Saved on the phone; browse and search start from it. */
export function DietPrefChips() {
  const diet = useAssist((s) => s.dietPref);
  const setDiet = useAssist((s) => s.setDietPref);
  return (
    <View style={styles.row}>
      <Text style={styles.label}>My diet</Text>
      {PREFS.map((p) => {
        const on = diet.includes(p.tag);
        return (
          <Pressable
            key={p.tag}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            onPress={() => void setDiet(on ? diet.filter((d) => d !== p.tag) : [...diet, p.tag])}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text style={[styles.chipText, on && { color: colors.brand }]}>{on ? "✓ " : ""}{p.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  label: { color: colors.muted, fontWeight: "600" },
  chip: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  chipText: { color: colors.text, fontWeight: "500" },
});
