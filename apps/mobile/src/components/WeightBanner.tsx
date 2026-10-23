import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useCart } from "../lib/cart-store";
import { DEMO } from "../lib/config";
import { demo } from "../lib/demo";
import { colors } from "../lib/theme";

/**
 * The cart's scale disagrees with what was scanned. The shopper is told first, kindly: most of the time
 * it's an item they forgot to scan or a bag they put down. Staff hear about it only if it lasts.
 */
export function WeightBanner() {
  const weight = useCart((s) => s.weight);
  const sessionId = useCart((s) => s.cart?.sessionId);
  if (!weight) return DEMO && sessionId ? <DemoUnscanned sessionId={sessionId} /> : null;
  const extra = weight.status === "extra";
  return (
    <View style={styles.box} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.title}>{extra ? "Something in your cart hasn't been scanned" : "An item you scanned isn't in the cart"}</Text>
      <Text style={styles.body}>
        {extra
          ? "Scan it now, or take it out. If it's your own bag, tap Call for help and we'll sort it."
          : "Put it back in the cart, or remove it from the list below so you're not charged for it."}
      </Text>
      <View style={styles.row}>
        {extra && (
          <Pressable accessibilityRole="button" onPress={() => router.push("/cart/scan")} style={[styles.button, styles.primary]}>
            <Text style={styles.primaryText}>Scan it</Text>
          </Pressable>
        )}
        <Pressable accessibilityRole="button" onPress={() => router.push("/help")} style={styles.button}>
          <Text style={styles.buttonText}>Call for help</Text>
        </Pressable>
      </View>
      {DEMO && sessionId && <DemoUnscanned sessionId={sessionId} />}
    </View>
  );
}

/** Demo builds only: there is no real scale, so the tester can put an item in without scanning it. */
function DemoUnscanned({ sessionId }: { sessionId: string }) {
  const [inBasket, setInBasket] = useState(() => demo().unscannedIn(sessionId));
  const weight = useCart((s) => s.weight);
  useEffect(() => setInBasket(demo().unscannedIn(sessionId)), [weight, sessionId]);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        demo().simulateUnscanned(sessionId, !inBasket);
        setInBasket(!inBasket);
      }}
      style={styles.demo}
    >
      <Text style={styles.demoText}>
        {inBasket ? "Demo: take the unscanned item out" : "Demo: put an item in without scanning"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: "#FEF3C7", borderColor: "#FCD34D", borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },
  title: { fontSize: 16, fontWeight: "700", color: "#78350F" },
  body: { color: "#78350F", lineHeight: 20 },
  row: { flexDirection: "row", gap: 8, marginTop: 4 },
  button: { borderRadius: 10, borderWidth: 1, borderColor: "#D97706", paddingHorizontal: 14, paddingVertical: 8 },
  buttonText: { color: "#92400E", fontWeight: "600" },
  primary: { backgroundColor: colors.brand, borderColor: colors.brand },
  primaryText: { color: "#fff", fontWeight: "600" },
  demo: { alignSelf: "flex-start", paddingVertical: 6 },
  demoText: { color: "#0369A1", fontSize: 13, textDecorationLine: "underline" },
});
