import type { CartLine, CartTotals } from "@smart-cart/contracts";
import { StyleSheet, Text, View } from "react-native";
import { formatInr, formatRate } from "../lib/money";
import { colors } from "../lib/theme";

type GstRow = { gstRateBp: number; taxablePaise: number; taxPaise: number };

/** Lines, the GST summary per rate (as printed on Indian tax invoices) and the totals. */
export function ReceiptLines({ lines, totals, gstSummary }: { lines: CartLine[]; totals: CartTotals; gstSummary: GstRow[] }) {
  return (
    <View style={styles.card}>
      {lines.map((l) => (
        <View key={l.productId} style={styles.row}>
          <Text style={styles.name}>
            {l.name} <Text style={styles.muted}>× {l.qty}</Text>
          </Text>
          <Text style={styles.amount}>{formatInr(l.lineTotalPaise)}</Text>
        </View>
      ))}
      <View style={styles.rule} />
      {gstSummary
        .filter((g) => g.taxPaise > 0)
        .map((g) => (
          <View key={g.gstRateBp} style={styles.row}>
            <Text style={styles.muted}>
              GST {formatRate(g.gstRateBp)} on {formatInr(g.taxablePaise)}
            </Text>
            <Text style={styles.muted}>{formatInr(g.taxPaise)}</Text>
          </View>
        ))}
      <View style={styles.row}>
        <Text style={styles.muted}>GST included</Text>
        <Text style={styles.muted}>{formatInr(totals.taxPaise)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.total}>Total · {totals.itemCount} items</Text>
        <Text style={styles.total}>{formatInr(totals.totalPaise)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  name: { flex: 1, color: colors.text },
  amount: { color: colors.text, fontVariant: ["tabular-nums"] },
  muted: { color: colors.muted, fontVariant: ["tabular-nums"] },
  rule: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
  total: { fontSize: 18, fontWeight: "700", color: colors.text, fontVariant: ["tabular-nums"] },
});
