import { DEMO_APP_CARTS } from "@smart-cart/demo";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ScannerView } from "../components/ScannerView";
import { ApiError } from "../lib/api";
import { useCart } from "../lib/cart-store";
import { DEFAULT_STORE_ID } from "../lib/config";
import { parseCartInput } from "../lib/qr";
import { colors } from "../lib/theme";

const messages: Record<string, (cart: string) => string> = {
  cart_in_use: (c) => `Someone is already using cart ${c}. Please take another cart.`,
  cart_not_found: (c) => `Cart ${c} is not registered at this store.`,
  cart_in_maintenance: (c) => `Cart ${c} is out of service. Please take another cart.`,
  already_shopping: () => "You already have a cart open. Finish or leave it first.",
};

export default function PairScreen() {
  const { store } = useLocalSearchParams<{ store?: string }>();
  const storeId = store ?? DEFAULT_STORE_ID;
  const pair = useCart((s) => s.pair);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCode = async (raw: string) => {
    if (busy) return;
    const qr = parseCartInput(raw, storeId);
    if (!qr) {
      setError("That isn't a Smart Cart code. Scan the QR on the cart handle.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await pair(qr.cartCode, qr.storeId);
      router.replace("/cart");
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setError(messages[code]?.(qr.cartCode) ?? "Could not pair the cart. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScannerView
        barcodeTypes={["qr"]}
        paused={busy}
        onCode={onCode}
        manualLabel="No camera? Type the cart number printed on the handle."
        manualPlaceholder="C-0001"
        demoTitle="Carts by the entrance"
        demoPicks={DEMO_APP_CARTS.map((c) => ({ code: c, label: `Cart ${c}`, sub: "QR on the handle" }))}
      />
      <View style={styles.footer}>
        <Text style={styles.hint}>{busy ? "Pairing…" : "Point the camera at the QR code on the cart handle."}</Text>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  footer: { padding: 16, paddingBottom: 32, gap: 8 },
  hint: { fontSize: 16, fontWeight: "600", color: colors.text },
  error: { color: colors.danger },
});
