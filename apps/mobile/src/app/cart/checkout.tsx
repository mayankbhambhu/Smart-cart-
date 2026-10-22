import type { CheckoutResponse } from "@smart-cart/contracts";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../../components/Button";
import { ReceiptLines } from "../../components/ReceiptLines";
import { ApiError } from "../../lib/api";
import { useCart } from "../../lib/cart-store";
import { formatInr } from "../../lib/money";
import { collectPayment } from "../../lib/payment";
import { colors } from "../../lib/theme";

/** Review the frozen order and pay. Scanning is paused while this screen is open. */
export default function CheckoutScreen() {
  const insets = useSafeAreaInsets();
  const [checkout, setCheckout] = useState<CheckoutResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"pay" | "back" | null>(null);

  useEffect(() => {
    useCart
      .getState()
      .checkout()
      .then(setCheckout)
      .catch((e) =>
        setError(
          e instanceof ApiError && e.code === "cart_empty"
            ? "Your cart is empty. Scan an item first."
            : "Could not start checkout. Check your connection and try again.",
        ),
      );
  }, []);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{error}</Text>
        <Button title="Back to cart" variant="secondary" onPress={() => router.back()} style={{ marginTop: 16 }} />
      </View>
    );
  }
  if (!checkout) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const { order, payment } = checkout;
  const pay = async () => {
    setBusy("pay");
    try {
      const result = await collectPayment(order.orderId, payment);
      if (result.kind === "paid") {
        useCart.getState().markPaid(order.orderId);
        router.dismissAll();
        router.replace({ pathname: "/receipt/[orderId]", params: { orderId: order.orderId } });
      } else if (result.kind === "failed") {
        Alert.alert("Payment did not go through", result.message);
      }
    } catch {
      Alert.alert("Payment did not go through", "Check your connection and try again. You were not charged twice.");
    } finally {
      setBusy(null);
    }
  };
  const backToCart = async () => {
    setBusy("back");
    try {
      await useCart.getState().backToCart(order.orderId);
      router.back();
    } catch {
      Alert.alert("Could not reopen the cart", "Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>Review and pay</Text>
        <Text style={styles.muted}>Prices are locked for this order. To change items, go back to the cart.</Text>
        <ReceiptLines lines={order.lines} totals={order.totals} gstSummary={order.gstSummary} />
        {payment.provider === "fake" && (
          <Text style={styles.note}>Test payment: no money is taken. Real payments use Stripe.</Text>
        )}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
        <Button title={`Pay ${formatInr(order.totals.totalPaise)}`} onPress={() => void pay()} busy={busy === "pay"} disabled={busy !== null} />
        <Button title="Back to cart" variant="secondary" onPress={() => void backToCart()} busy={busy === "back"} disabled={busy !== null} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  body: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  muted: { color: colors.muted, textAlign: "left" },
  note: { color: colors.muted, fontSize: 13, textAlign: "center" },
  footer: { backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border, padding: 16, gap: 8 },
});
