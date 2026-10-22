import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { Button } from "../../components/Button";
import { ReceiptLines } from "../../components/ReceiptLines";
import { api } from "../../lib/api";
import { colors } from "../../lib/theme";

/** The e-receipt. The exit QR and code are what staff check at the door. */
export default function ReceiptScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const order = useQuery({ queryKey: ["order", orderId], queryFn: () => api.order(orderId) });

  if (!order.data) {
    return (
      <View style={styles.center}>
        {order.isError ? <Text style={styles.muted}>Could not load the receipt.</Text> : <ActivityIndicator color={colors.brand} />}
      </View>
    );
  }
  const r = order.data;
  const when = new Date(r.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {r.exitQr && r.exitCode ? (
        <View style={styles.exit}>
          <Text style={styles.paid}>Paid · show this at the exit</Text>
          <View style={styles.qr}>
            <QRCode value={r.exitQr} size={200} />
          </View>
          <Text style={styles.code} accessibilityLabel={`Exit code ${r.exitCode.split("").join(" ")}`}>
            {r.exitCode}
          </Text>
          {r.exitUsedAt && <Text style={styles.muted}>Checked at the exit</Text>}
        </View>
      ) : (
        <Text style={styles.muted}>This order is not paid yet.</Text>
      )}
      <View>
        <Text style={styles.store}>{r.storeName}</Text>
        <Text style={styles.muted}>
          {when} · Cart {r.cartCode} · Order {r.orderId.slice(0, 8).toUpperCase()}
        </Text>
      </View>
      <ReceiptLines lines={r.lines} totals={r.totals} gstSummary={r.gstSummary} />
      <Button title="Done" variant="secondary" onPress={() => router.replace("/")} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  body: { padding: 16, gap: 16 },
  exit: { alignItems: "center", backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 20, gap: 12 },
  paid: { color: colors.brand, fontWeight: "700", fontSize: 16 },
  qr: { padding: 12, backgroundColor: "#fff", borderRadius: 8 },
  code: { fontSize: 32, fontWeight: "800", letterSpacing: 6, color: colors.text, fontVariant: ["tabular-nums"] },
  store: { fontSize: 17, fontWeight: "600", color: colors.text },
  muted: { color: colors.muted },
});
