import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useDeals } from "../lib/deals-store";
import { colors } from "../lib/theme";
import { dealPrice } from "../lib/voice-logic";

/** The nudge when the shopper's cart reaches an aisle with deals they haven't picked up (US-08). */
export function DealAlert() {
  const alert = useDeals((s) => s.alert);
  const dismiss = useDeals((s) => s.dismiss);
  if (!alert) return null;
  const shown = alert.offers.slice(0, 3);
  return (
    <View style={styles.card} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <View style={styles.top}>
        <Text style={styles.title}>🏷️ Deals in aisle {alert.aisle}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss deals" onPress={dismiss} hitSlop={10}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>
      {shown.map((o) => (
        <View key={o.id} style={styles.row}>
          <Text style={styles.name} numberOfLines={1}>
            {o.name}
            {o.shelf ? <Text style={styles.muted}> · shelf {o.shelf}</Text> : null}
          </Text>
          <Text style={styles.price}>{dealPrice(o)}</Text>
        </View>
      ))}
      {alert.offers.length > shown.length && <Text style={styles.muted}>and {alert.offers.length - shown.length} more</Text>}
      <Pressable accessibilityRole="button" onPress={() => router.push("/deals")}>
        <Text style={styles.link}>See all deals</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#FFF7ED", borderColor: "#FDBA74", borderWidth: 1, borderRadius: 14, padding: 12, gap: 6 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 15, fontWeight: "700", color: "#9A3412" },
  close: { fontSize: 16, color: "#9A3412" },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  name: { flex: 1, color: colors.text },
  price: { fontWeight: "700", color: colors.text },
  muted: { color: colors.muted, fontSize: 13 },
  link: { color: "#9A3412", fontWeight: "600", marginTop: 2 },
});
