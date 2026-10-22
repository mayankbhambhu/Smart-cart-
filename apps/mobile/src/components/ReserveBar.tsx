import { router } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";
import { useReserve } from "../lib/reserve-store";
import { colors } from "../lib/theme";

/** Shown under product lists while the shopper is picking items to reserve. */
export function ReserveBar() {
  const count = useReserve((s) => Object.values(s.qty).reduce((a, b) => a + b, 0));
  if (count === 0) return null;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push("/reserve")} style={styles.bar}>
      <Text style={styles.text}>
        Reserve {count} {count === 1 ? "item" : "items"} for pickup ›
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { margin: 12, backgroundColor: colors.brand, borderRadius: 14, padding: 16, alignItems: "center" },
  text: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
