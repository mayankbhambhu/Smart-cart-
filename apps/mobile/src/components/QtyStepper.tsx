import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../lib/theme";

/** "Reserve" until something is added, then − n +. */
export function QtyStepper({ qty, onChange, label = "Reserve", max = 20 }: { qty: number; onChange: (qty: number) => void; label?: string; max?: number }) {
  if (qty === 0) {
    return (
      <Pressable accessibilityRole="button" onPress={() => onChange(1)} style={styles.add}>
        <Text style={styles.addText}>+ {label}</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel="One less" onPress={() => onChange(qty - 1)} style={styles.step}>
        <Text style={styles.stepText}>−</Text>
      </Pressable>
      <Text style={styles.qty} accessibilityLabel={`${qty} reserved`}>{qty}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="One more"
        disabled={qty >= max}
        onPress={() => onChange(qty + 1)}
        style={[styles.step, qty >= max && { opacity: 0.4 }]}
      >
        <Text style={styles.stepText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  add: { alignSelf: "flex-start", backgroundColor: colors.brandSoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  addText: { color: colors.brand, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "flex-start" },
  step: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  stepText: { color: colors.brand, fontSize: 20, fontWeight: "700" },
  qty: { minWidth: 24, textAlign: "center", fontSize: 16, fontWeight: "700", color: colors.text },
});
