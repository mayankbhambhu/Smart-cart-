import type { ReactNode } from "react";
import type { SearchResult } from "@smart-cart/contracts";
import { StyleSheet, Text, View } from "react-native";
import { stockLabel, unitPriceLabel, whereLabel } from "../lib/assist-logic";
import { formatInr } from "../lib/money";
import { FoodMark } from "./FoodMark";
import { colors } from "../lib/theme";

const stockColors = {
  in_stock: { bg: colors.brandSoft, fg: colors.brand },
  low: { bg: "#FEF3C7", fg: "#92400E" },
  out: { bg: colors.dangerSoft, fg: colors.danger },
  unknown: { bg: "#F1F5F9", fg: colors.muted },
};

const dietNames: Record<string, string> = {
  jain: "Jain",
  vegan: "Vegan",
  gluten_free: "Gluten free",
  sugar_free: "Sugar free",
  no_added_sugar: "No added sugar",
};

/** One product with where it is, its price, price per kg/L and stock, all from store data. */
export function ProductResult({ product, badge, children }: { product: SearchResult; badge?: string; children?: ReactNode }) {
  const unit = unitPriceLabel(product);
  const stock = stockColors[product.stock];
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          {badge && <Text style={styles.badge}>{badge}</Text>}
          <Text style={styles.name}>{product.name}</Text>
          <Text style={styles.where}>{whereLabel(product)}</Text>
        </View>
        <View style={styles.prices}>
          <Text style={styles.price}>{formatInr(product.pricePaise)}</Text>
          {product.mrpPaise > product.pricePaise && <Text style={styles.mrp}>MRP {formatInr(product.mrpPaise)}</Text>}
          {unit && <Text style={styles.unit}>{unit}</Text>}
        </View>
      </View>
      <View style={styles.tags}>
        <FoodMark type={product.foodType} />
        <Text style={[styles.pill, { backgroundColor: stock.bg, color: stock.fg }]}>{stockLabel[product.stock]}</Text>
        {product.dietTags.map((t) => (
          <Text key={t} style={[styles.pill, styles.diet]}>
            {dietNames[t] ?? t}
          </Text>
        ))}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 8 },
  top: { flexDirection: "row", gap: 12 },
  badge: { alignSelf: "flex-start", fontSize: 11, fontWeight: "700", color: colors.brand, marginBottom: 2, letterSpacing: 0.3 },
  name: { fontSize: 16, fontWeight: "600", color: colors.text },
  where: { fontSize: 14, color: colors.brand, fontWeight: "600", marginTop: 2 },
  prices: { alignItems: "flex-end" },
  price: { fontSize: 16, fontWeight: "700", color: colors.text },
  mrp: { fontSize: 12, color: colors.muted, textDecorationLine: "line-through" },
  unit: { fontSize: 12, color: colors.muted, marginTop: 2 },
  tags: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  pill: { fontSize: 12, fontWeight: "600", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: "hidden" },
  diet: { backgroundColor: "#F1F5F9", color: colors.text },
});
