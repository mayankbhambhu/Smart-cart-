import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../components/Button";
import { FindItFast } from "../components/FindItFast";
import { HelpBanner } from "../components/HelpBanner";
import { ReservationCard } from "../components/ReservationCard";
import { api } from "../lib/api";
import { useAssist } from "../lib/assist-store";
import { useAuth } from "../lib/auth-store";
import { useCart } from "../lib/cart-store";
import { useDeals } from "../lib/deals-store";
import { formatInr } from "../lib/money";
import { colors } from "../lib/theme";

export default function HomeScreen() {
  const session = useAuth((s) => s.session);
  const signOut = useAuth((s) => s.signOut);
  const cart = useCart((s) => s.cart);
  const stores = useQuery({ queryKey: ["stores"], queryFn: api.stores });
  const receipts = useQuery({ queryKey: ["my-orders"], queryFn: api.myOrders });

  const paidOrderId = useCart((s) => s.paidOrderId);
  useEffect(() => {
    if (paidOrderId) void receipts.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paidOrderId]);

  // If the app was closed mid-shop, pick the open cart back up.
  useEffect(() => {
    useCart
      .getState()
      .resume()
      .catch(() => {});
    void useAssist.getState().loadBudget();
    void useDeals.getState().load();
    useAssist
      .getState()
      .refreshHelp()
      .catch(() => {});
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.hello}>Hello, {session?.name}</Text>

      {cart ? (
        <Pressable accessibilityRole="button" onPress={() => router.push("/cart")} style={styles.resume}>
          <Text style={styles.resumeTitle}>Continue with cart {cart.cartCode}</Text>
          <Text style={styles.muted}>{cart.totals.itemCount} {cart.totals.itemCount === 1 ? "item" : "items"}</Text>
        </Pressable>
      ) : (
        <>
          <Text style={styles.section}>Choose your store</Text>
          {stores.isPending ? (
            <ActivityIndicator color={colors.brand} />
          ) : stores.isError ? (
            <View style={styles.card}>
              <Text>Could not reach the store server.</Text>
              <Button title="Try again" variant="secondary" onPress={() => void stores.refetch()} style={{ marginTop: 12 }} />
            </View>
          ) : (
            stores.data.map((s) => (
              <Pressable
                key={s.id}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: "/pair", params: { store: s.id } })}
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
              >
                <Text style={styles.storeName}>{s.name}</Text>
                <Text style={styles.muted}>{s.city}</Text>
                <Text style={styles.start}>Start shopping ›</Text>
              </Pressable>
            ))
          )}
        </>
      )}

      <Text style={styles.section}>Find it fast</Text>
      <FindItFast />
      <ReservationCard />
      <HelpBanner />

      {receipts.data && receipts.data.length > 0 && (
        <>
          <Text style={styles.section}>Past receipts</Text>
          {receipts.data.slice(0, 5).map((r) => (
            <Pressable
              key={r.orderId}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/receipt/[orderId]", params: { orderId: r.orderId } })}
              style={({ pressed }) => [styles.card, styles.receipt, pressed && { opacity: 0.8 }]}
            >
              <View>
                <Text style={styles.storeName}>{formatInr(r.totals.totalPaise)}</Text>
                <Text style={styles.muted}>
                  {new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} ·{" "}
                  {r.totals.itemCount} {r.totals.itemCount === 1 ? "item" : "items"}
                </Text>
              </View>
              <Text style={styles.start}>Receipt ›</Text>
            </Pressable>
          ))}
        </>
      )}

      <Pressable accessibilityRole="button" onPress={() => void signOut()} style={styles.signOut}>
        <Text style={styles.muted}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  hello: { fontSize: 24, fontWeight: "700", color: colors.text, marginBottom: 8 },
  section: { fontSize: 16, fontWeight: "600", color: colors.text },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border },
  storeName: { fontSize: 17, fontWeight: "600", color: colors.text },
  start: { color: colors.brand, fontWeight: "600", marginTop: 8 },
  receipt: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  resume: { backgroundColor: colors.brandSoft, borderRadius: 14, padding: 16 },
  resumeTitle: { fontSize: 17, fontWeight: "600", color: colors.brand },
  muted: { color: colors.muted },
  signOut: { alignSelf: "center", padding: 16, marginTop: 24 },
});
