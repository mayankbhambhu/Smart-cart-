import type { Offer } from "@smart-cart/contracts";
import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, SectionList, StyleSheet, Switch, Text, View } from "react-native";
import { FoodMark } from "../components/FoodMark";
import { api } from "../lib/api";
import { stockLabel } from "../lib/assist-logic";
import { useAssist } from "../lib/assist-store";
import { useDeals } from "../lib/deals-store";
import { formatInr } from "../lib/money";
import { colors } from "../lib/theme";

const until = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

/** Today's deals aisle by aisle, as the store's managers set them (US-08), for the shopper's diet. */
export default function DealsScreen() {
  const storeId = useAssist((s) => s.storeId);
  const diet = useAssist((s) => s.dietPref);
  const { alertsOn, setAlertsOn, aisle } = useDeals();
  const offers = useQuery({ queryKey: ["offers", storeId, diet], queryFn: () => api.offers(storeId, null, diet) });

  const sections: { title: string; data: Offer[] }[] = [];
  for (const o of offers.data ?? []) {
    const title = o.aisle ?? "Elsewhere";
    if (sections.at(-1)?.title !== title) sections.push({ title, data: [] });
    sections.at(-1)!.data.push(o);
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(o) => o.id}
      contentContainerStyle={styles.list}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View style={styles.head}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchTitle}>Tell me about deals in my aisle</Text>
              <Text style={styles.muted}>
                When you scan an item, we show that aisle's deals once.{aisle ? ` Your cart is in aisle ${aisle}.` : ""}
              </Text>
            </View>
            <Switch
              value={alertsOn}
              onValueChange={(on) => void setAlertsOn(on)}
              trackColor={{ true: colors.brand }}
              accessibilityLabel="Deal alerts by aisle"
            />
          </View>
          {diet.length > 0 && <Text style={styles.muted}>Showing deals that match your diet preference.</Text>}
        </View>
      }
      renderSectionHeader={({ section }) => (
        <Text style={[styles.aisle, section.title === aisle && { color: colors.brand }]}>
          Aisle {section.title}
          {section.title === aisle ? " · you're here" : ""}
        </Text>
      )}
      renderItem={({ item: o }) => (
        <View style={styles.card}>
          <View style={styles.top}>
            <View style={{ flex: 1 }}>
              <Text style={styles.offerTitle}>{o.title}</Text>
              <Text style={styles.name}>{o.name}</Text>
              <Text style={styles.where}>{o.shelf ? `Shelf ${o.shelf}` : "On the aisle"}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.price}>{formatInr(o.offerPricePaise)}</Text>
              <Text style={styles.was}>{formatInr(o.regularPaise)}</Text>
              <Text style={styles.save}>Save {formatInr(o.savingsPaise)}</Text>
            </View>
          </View>
          <View style={styles.tags}>
            <FoodMark type={o.foodType} />
            <Text style={styles.muted}>
              {stockLabel[o.stock]} · until {until(o.endsAt)}
            </Text>
          </View>
        </View>
      )}
      ListEmptyComponent={
        offers.isPending ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />
        ) : offers.isError ? (
          <Text style={styles.muted}>Could not load deals right now. Check your connection.</Text>
        ) : (
          <Text style={styles.muted}>No deals running right now.</Text>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  head: { gap: 8, marginBottom: 4 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12 },
  switchTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  aisle: { fontSize: 13, fontWeight: "700", color: colors.muted, letterSpacing: 0.4, textTransform: "uppercase", marginTop: 8 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 8 },
  top: { flexDirection: "row", gap: 12 },
  offerTitle: { fontSize: 12, fontWeight: "700", color: "#9A3412" },
  name: { fontSize: 16, fontWeight: "600", color: colors.text },
  where: { fontSize: 14, color: colors.brand, fontWeight: "600", marginTop: 2 },
  price: { fontSize: 17, fontWeight: "700", color: colors.text },
  was: { fontSize: 12, color: colors.muted, textDecorationLine: "line-through" },
  save: { fontSize: 12, fontWeight: "700", color: "#9A3412" },
  tags: { flexDirection: "row", alignItems: "center", gap: 6 },
  muted: { color: colors.muted, lineHeight: 20 },
});
