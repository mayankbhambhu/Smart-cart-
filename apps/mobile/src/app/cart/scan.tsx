import { demoShelf } from "@smart-cart/demo";
import * as Crypto from "expo-crypto";
import { useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { ScannerView } from "../../components/ScannerView";
import { api, ApiError, type ProductPreview } from "../../lib/api";
import { useCart } from "../../lib/cart-store";
import { formatInr, formatRate } from "../../lib/money";
import { colors } from "../../lib/theme";

/**
 * Continuous barcode scanning. Each scan shows a product preview; the shopper confirms before
 * it is added, so a stray scan of the wrong pack doesn't land in the cart.
 */
export default function ScanItemScreen() {
  const cart = useCart((s) => s.cart);
  const add = useCart((s) => s.add);
  const [preview, setPreview] = useState<ProductPreview | null>(null);
  const [looking, setLooking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const onCode = async (code: string) => {
    if (preview || looking || !cart) return;
    setLooking(true);
    setMessage(null);
    try {
      const product = await api.product(code, cart.storeId);
      if (product) setPreview(product);
      else setMessage(`Barcode ${code} is not sold in this store. Ask a staff member.`);
    } catch {
      setMessage("Could not reach the store server.");
    } finally {
      setLooking(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScannerView
        barcodeTypes={["ean13", "ean8", "upc_a"]}
        paused={preview !== null || looking}
        onCode={onCode}
        manualLabel="Barcode won't scan? Type the number under it."
        manualPlaceholder="2000000000015"
        demoTitle="Demo shelf"
        demoPicks={demoShelf.map((p) => ({ code: p.barcode, label: p.name, sub: `${formatInr(p.pricePaise)} · Aisle ${p.aisle}` }))}
      />
      <View style={styles.footer}>
        <Text style={styles.hint}>{message ?? "Point the camera at the barcode on the pack."}</Text>
        {cart && <Text style={styles.total}>Cart total {formatInr(cart.totals.totalPaise)}</Text>}
      </View>
      {preview && (
        <AddSheet
          product={preview}
          onClose={(addedName) => {
            setPreview(null);
            if (addedName) setMessage(`Added ${addedName}`);
          }}
          add={add}
        />
      )}
    </View>
  );
}

function AddSheet({
  product,
  onClose,
  add,
}: {
  product: ProductPreview;
  onClose: (addedName?: string) => void;
  add: (barcode: string, qty: number, requestId: string) => Promise<unknown>;
}) {
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept for this preview so a retry after a network error is applied once by the server.
  const requestId = useRef(Crypto.randomUUID()).current;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await add(product.barcode, qty, requestId);
      onClose(product.name);
    } catch (e) {
      setBusy(false);
      setError(e instanceof ApiError && e.code === "session_not_active" ? "This cart is no longer open." : "Could not add the item. Try again.");
    }
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={() => onClose()}>
      <Pressable style={styles.backdrop} onPress={() => onClose()} accessibilityLabel="Close" />
      <View style={styles.sheet}>
        <Text style={styles.name}>{product.name}</Text>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{formatInr(product.pricePaise)}</Text>
          {product.mrpPaise > product.pricePaise && <Text style={styles.mrp}>MRP {formatInr(product.mrpPaise)}</Text>}
          <Text style={styles.gst}>incl. GST {formatRate(product.gstRateBp)}</Text>
        </View>
        <View style={styles.stepper}>
          <Pressable accessibilityRole="button" accessibilityLabel="One fewer" disabled={qty <= 1} onPress={() => setQty((q) => q - 1)} style={styles.step}>
            <Text style={styles.stepText}>−</Text>
          </Pressable>
          <Text style={styles.qty} accessibilityLabel={`Quantity ${qty}`}>
            {qty}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="One more" disabled={qty >= 50} onPress={() => setQty((q) => q + 1)} style={styles.step}>
            <Text style={styles.stepText}>+</Text>
          </Pressable>
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        <Button title="Add to cart" onPress={confirm} busy={busy} />
        <Pressable accessibilityRole="button" onPress={() => onClose()} style={styles.notThis}>
          <Text style={styles.notThisText}>Not this one</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  footer: { padding: 16, paddingBottom: 32, gap: 4 },
  hint: { fontSize: 16, color: colors.text },
  total: { color: colors.muted },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { backgroundColor: colors.surface, padding: 24, paddingBottom: 40, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 12 },
  name: { fontSize: 20, fontWeight: "700", color: colors.text },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  price: { fontSize: 18, fontWeight: "600", color: colors.text },
  mrp: { color: colors.muted, textDecorationLine: "line-through" },
  gst: { marginLeft: "auto", color: colors.muted, fontSize: 12 },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 24, marginVertical: 8 },
  step: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 22, color: colors.text },
  qty: { fontSize: 24, fontWeight: "600", minWidth: 32, textAlign: "center" },
  error: { color: colors.danger },
  notThis: { alignSelf: "center", padding: 8 },
  notThisText: { color: colors.muted },
});
