import type { ExitCheckResponse } from "@smart-cart/contracts";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "../../components/Button";
import { staffApi } from "../../lib/api";
import { formatInr } from "../../lib/money";
import { useStaffStore } from "../../lib/staff-hooks";
import { colors } from "../../lib/theme";

/** At the door: the shopper shows the exit code on their receipt; one code lets one cart out. */
export default function ExitCheck() {
  const storeId = useStaffStore();
  const [code, setCode] = useState("");
  const [result, setResult] = useState<ExitCheckResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await staffApi.exitCheck(storeId, code.trim()));
    } catch {
      setError("Could not reach the store server.");
    } finally {
      setBusy(false);
    }
  };

  const verdict = result && {
    ok: { text: "✓ Paid. Let them through.", style: styles.ok },
    already_used: { text: "Already used. Check the receipt with them.", style: styles.warn },
    not_found: { text: "No paid order with that code.", style: styles.error },
    not_paid: { text: "Not paid yet. Ask them to finish paying in the app.", style: styles.warn },
  }[result.result];

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <TextInput
        value={code}
        onChangeText={(t) => {
          setCode(t.toUpperCase());
          setResult(null);
        }}
        placeholder="6-character exit code"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={64}
        style={styles.input}
        onSubmitEditing={() => void check()}
        accessibilityLabel="Exit code"
      />
      <Button title="Check" busy={busy} disabled={code.trim().length < 6} onPress={() => void check()} />
      {error && <Text style={styles.error}>{error}</Text>}
      {verdict && <Text style={[styles.verdict, verdict.style]}>{verdict.text}</Text>}
      {result?.order && (
        <View style={styles.card}>
          <Text style={styles.title}>
            {formatInr(result.order.totals.totalPaise)} · {result.order.totals.itemCount} items · cart {result.order.cartCode}
          </Text>
          {result.order.lines.map((l) => (
            <Text key={l.productId} style={styles.muted}>
              {l.qty} × {l.name}
            </Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, minHeight: 56, fontSize: 22, letterSpacing: 4, textAlign: "center", backgroundColor: colors.surface },
  verdict: { fontSize: 18, fontWeight: "700", borderRadius: 12, padding: 14, overflow: "hidden" },
  ok: { color: colors.brand, backgroundColor: colors.brandSoft },
  warn: { color: "#92400E", backgroundColor: "#FEF3C7" },
  error: { color: colors.danger, backgroundColor: colors.dangerSoft, borderRadius: 10, padding: 10 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 4 },
  title: { fontWeight: "700", color: colors.text },
  muted: { color: colors.muted },
});
