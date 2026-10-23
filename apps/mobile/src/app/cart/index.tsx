import type { CartLine, CartTotals } from "@smart-cart/contracts";
import { router, Stack } from "expo-router";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BudgetBar } from "../../components/BudgetBar";
import { DealAlert } from "../../components/DealAlert";
import { Button } from "../../components/Button";
import { FindItFast } from "../../components/FindItFast";
import { HelpBanner } from "../../components/HelpBanner";
import { useCart } from "../../lib/cart-store";
import { formatInr, formatRate } from "../../lib/money";
import { colors } from "../../lib/theme";

const endedText: Record<string, string> = {
  abandoned: "Your cart was released after 30 minutes without activity.",
  cancelled: "You left the cart. Nothing was charged.",
  paid: "Paid. Your receipt is in Past receipts on the home screen.",
};

/** The live cart: every line, GST and the running total, all as the server computed them. */
export default function LiveCartScreen() {
  const { cart, live, endedReason, removeOne, removeAll, leave } = useCart();
  const insets = useSafeAreaInsets();

  if (!cart) {
    return (
      <View style={styles.center}>
        <Text style={styles.centerText}>{(endedReason && endedText[endedReason]) ?? "No cart paired."}</Text>
        <Button title="Back to start" onPress={() => router.replace("/")} style={{ marginTop: 16 }} />
      </View>
    );
  }

  const confirmLeave = () =>
    Alert.alert("Leave this cart?", "Put the items back on the shelf. Nothing will be charged.", [
      { text: "Keep shopping", style: "cancel" },
      {
        text: "Leave cart",
        style: "destructive",
        onPress: () => {
          leave()
            .then(() => router.replace("/"))
            .catch(() => Alert.alert("Could not leave the cart", "Check your connection and try again."));
        },
      },
    ]);

  // Set while an order is waiting for payment: the cart is frozen until the shopper pays or goes back.
  const paying = cart.status === "checking_out";

  const safeRemove = (fn: () => Promise<void>) => () => {
    fn().catch(() => Alert.alert("Could not update the cart", "Check your connection and try again."));
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: `Cart ${cart.cartCode}`,
          headerRight: () => (
            <View style={styles.live} accessibilityLabel={live ? "Live" : "Reconnecting"}>
              <View style={[styles.dot, { backgroundColor: live ? "#16A34A" : "#94A3B8" }]} />
              <Text style={styles.liveText}>{live ? "Live" : "Reconnecting"}</Text>
            </View>
          ),
        }}
      />
      <FlatList
        data={cart.lines}
        keyExtractor={(l) => l.productId}
        contentContainerStyle={cart.lines.length === 0 ? styles.emptyList : { paddingBottom: 16 }}
        ListHeaderComponent={
          <View style={styles.tools}>
            <DealAlert />
            <FindItFast />
            <HelpBanner compact />
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.centerText}>Your cart is empty.{"\n"}Scan each item as you put it in the cart.</Text>
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => (
          <LineRow line={item} onRemoveOne={safeRemove(() => removeOne(item.productId))} onRemoveAll={safeRemove(() => removeAll(item.productId))} />
        )}
      />
      <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
        <BudgetBar totalPaise={cart.totals.totalPaise} />
        <Totals totals={cart.totals} />
        <Button title="Scan item" disabled={paying} onPress={() => router.push("/cart/scan")} />
        <Button
          title={paying ? "Continue to payment" : "Checkout"}
          variant="secondary"
          disabled={cart.lines.length === 0}
          onPress={() => router.push("/cart/checkout")}
        />
        <Pressable accessibilityRole="button" onPress={confirmLeave} style={styles.leave}>
          <Text style={styles.leaveText}>Leave cart without buying</Text>
        </Pressable>
      </View>
    </View>
  );
}

function LineRow({ line, onRemoveOne, onRemoveAll }: { line: CartLine; onRemoveOne: () => void; onRemoveAll: () => void }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{line.name}</Text>
        <Text style={styles.muted}>
          {formatInr(line.unitPricePaise)} each · GST {formatRate(line.gstRateBp)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove one ${line.name}`}
        onPress={onRemoveOne}
        onLongPress={onRemoveAll}
        hitSlop={8}
        style={styles.minus}
      >
        <Text style={styles.minusText}>−</Text>
      </Pressable>
      <View style={styles.amounts}>
        <Text style={styles.muted}>× {line.qty}</Text>
        <Text style={styles.lineTotal}>{formatInr(line.lineTotalPaise)}</Text>
      </View>
    </View>
  );
}

function Totals({ totals }: { totals: CartTotals }) {
  const row = (label: string, value: string, strong = false) => (
    <View style={styles.totalRow}>
      <Text style={strong ? styles.totalStrong : styles.muted}>{label}</Text>
      <Text style={strong ? styles.totalStrong : styles.muted}>{value}</Text>
    </View>
  );
  return (
    <View style={{ marginBottom: 8 }}>
      {row("Items", String(totals.itemCount))}
      {row("Before GST", formatInr(totals.subtotalPaise))}
      {row("GST included", formatInr(totals.taxPaise))}
      {row("Total", formatInr(totals.totalPaise), true)}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  centerText: { textAlign: "center", color: colors.muted, fontSize: 16 },
  emptyList: { flexGrow: 1, justifyContent: "center", paddingBottom: 32 },
  tools: { padding: 12, gap: 8 },
  separator: { height: 1, backgroundColor: colors.border },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface, gap: 12 },
  name: { fontSize: 16, fontWeight: "500", color: colors.text },
  muted: { color: colors.muted },
  minus: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  minusText: { fontSize: 20, color: colors.text, lineHeight: 22 },
  amounts: { alignItems: "flex-end", minWidth: 84 },
  lineTotal: { fontSize: 16, fontWeight: "600", color: colors.text },
  footer: { backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border, padding: 16, gap: 8 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1 },
  totalStrong: { fontSize: 20, fontWeight: "700", color: colors.text },
  leave: { alignSelf: "center", padding: 8 },
  leaveText: { color: colors.danger },
  live: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { fontSize: 12, color: colors.muted },
});
