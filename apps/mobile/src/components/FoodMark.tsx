import type { FoodType } from "@smart-cart/contracts";
import { StyleSheet, Text, View } from "react-native";
import { foodLabel } from "../lib/team-logic";
import { colors } from "../lib/theme";

/** The FSSAI mark from the pack: a dot in a square, green for veg, brown for non-veg and egg. */
export function FoodMark({ type, withText = true }: { type: FoodType | null | undefined; withText?: boolean }) {
  const label = foodLabel(type);
  if (type === "not_food") return null;
  return (
    <View style={styles.row} accessibilityLabel={label.text}>
      {label.dot ? (
        <View style={[styles.square, { borderColor: label.dot }]}>
          <View style={[styles.dot, { backgroundColor: label.dot }]} />
        </View>
      ) : null}
      {withText && <Text style={[styles.text, !label.dot && styles.unlabelled]}>{label.text}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  square: { width: 14, height: 14, borderWidth: 1.5, borderRadius: 2, alignItems: "center", justifyContent: "center" },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 12, fontWeight: "600", color: colors.text },
  unlabelled: { color: colors.muted, fontStyle: "italic" },
});
