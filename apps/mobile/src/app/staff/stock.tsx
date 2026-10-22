import type { StockLevel } from "@smart-cart/contracts";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "../../components/Button";
import { ApiError, staffApi } from "../../lib/api";
import { useStaffStore } from "../../lib/staff-hooks";
import { colors } from "../../lib/theme";

/** Look up a product by barcode, count the shelf, and correct the system's stock if it's wrong. */
export default function StockCheck() {
  const storeId = useStaffStore();
  const [barcode, setBarcode] = useState("");
  const [level, setLevel] = useState<StockLevel | null>(null);
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const lookUp = async () => {
    setBusy(true);
    setMessage(null);
    try {
      setLevel(await staffApi.stock(storeId, barcode.trim()));
      setCounted("");
      setReason("");
    } catch (e) {
      setLevel(null);
      setMessage({ ok: false, text: e instanceof ApiError && e.status === 404 ? "No product with that barcode." : "Could not reach the store server." });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!level) return;
    setBusy(true);
    try {
      const res = await staffApi.correct(storeId, level.barcode, Number(counted), reason.trim());
      setLevel(res);
      setMessage({
        ok: true,
        text: res.delta === 0 ? "Count matches the system. Recorded." : `Stock corrected by ${res.delta > 0 ? "+" : ""}${res.delta}. Your manager sees it in Reports.`,
      });
      setCounted("");
      setReason("");
    } catch {
      setMessage({ ok: false, text: "Could not save the count. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const countValid = /^\d{1,6}$/.test(counted) && reason.trim().length >= 2;
  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Barcode</Text>
      <TextInput value={barcode} onChangeText={setBarcode} placeholder="Scan or type, e.g. 2000000000152" keyboardType="number-pad" style={styles.input} onSubmitEditing={() => void lookUp()} accessibilityLabel="Barcode" />
      <Button title="Look up" busy={busy && !level} disabled={barcode.trim().length < 8} onPress={() => void lookUp()} />
      {level && (
        <View style={styles.card}>
          <Text style={styles.title}>{level.name}</Text>
          <Text style={styles.muted}>{level.aisle ? `Aisle ${level.aisle}, shelf ${level.shelf}` : "Location not mapped"}</Text>
          <View style={styles.stats}>
            <Stat label="System says" value={level.onHand} />
            <Stat label="In carts / reserved" value={level.reserved} />
            <Stat label="Available" value={level.available} />
          </View>
          <Text style={styles.label}>Units you counted on the shelf and in the back</Text>
          <TextInput value={counted} onChangeText={setCounted} keyboardType="number-pad" placeholder="e.g. 29" style={styles.input} accessibilityLabel="Units counted" />
          <TextInput value={reason} onChangeText={setReason} placeholder="Reason, e.g. two packs damaged" style={styles.input} accessibilityLabel="Reason" />
          <Button title="Save count" busy={busy} disabled={!countValid} onPress={() => void save()} />
        </View>
      )}
      {message && <Text style={message.ok ? styles.ok : styles.error}>{message.text}</Text>}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 8 },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  label: { fontWeight: "600", color: colors.text },
  muted: { color: colors.muted, fontSize: 13 },
  stats: { flexDirection: "row", gap: 8, marginVertical: 4 },
  statValue: { fontSize: 22, fontWeight: "700", color: colors.text },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, minHeight: 48, fontSize: 16, backgroundColor: colors.surface },
  ok: { color: colors.brand, backgroundColor: colors.brandSoft, borderRadius: 10, padding: 10 },
  error: { color: colors.danger, backgroundColor: colors.dangerSoft, borderRadius: 10, padding: 10 },
});
