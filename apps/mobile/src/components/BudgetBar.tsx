import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { budgetState, parseRupees } from "../lib/assist-logic";
import { useAssist } from "../lib/assist-store";
import { formatInr } from "../lib/money";
import { colors } from "../lib/theme";

/** The shopper's budget against the live cart total. Kept on the phone only. */
export function BudgetBar({ totalPaise }: { totalPaise: number }) {
  const budgetPaise = useAssist((s) => s.budgetPaise);
  const setBudget = useAssist((s) => s.setBudget);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

  if (editing || budgetPaise == null) {
    if (!editing) {
      return (
        <Pressable accessibilityRole="button" onPress={() => setEditing(true)} style={styles.set}>
          <Text style={styles.link}>Set a budget for this trip</Text>
        </Pressable>
      );
    }
    const save = () => {
      void setBudget(parseRupees(text));
      setEditing(false);
    };
    return (
      <View style={styles.editRow}>
        <Text style={styles.rupee}>₹</Text>
        <TextInput
          autoFocus
          value={text}
          onChangeText={setText}
          keyboardType="decimal-pad"
          placeholder="2,000"
          onSubmitEditing={save}
          style={styles.input}
          accessibilityLabel="Budget in rupees"
        />
        <Pressable accessibilityRole="button" onPress={save} style={styles.save}>
          <Text style={styles.saveText}>Save</Text>
        </Pressable>
      </View>
    );
  }

  const b = budgetState(totalPaise, budgetPaise);
  const color = b.over ? colors.danger : b.ratio > 0.85 ? "#D97706" : colors.brand;
  return (
    <Pressable accessibilityRole="button" accessibilityHint="Change budget" onPress={() => setEditing(true)} style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.muted}>Budget {formatInr(budgetPaise)}</Text>
        <Text style={[styles.left, { color }]}>
          {b.over ? `${formatInr(-b.leftPaise)} over` : `${formatInr(b.leftPaise)} left`}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${b.ratio * 100}%`, backgroundColor: color }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, marginBottom: 4 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  muted: { color: colors.muted },
  left: { fontWeight: "700" },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  set: { paddingVertical: 4 },
  link: { color: colors.brand, fontWeight: "600" },
  editRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  rupee: { fontSize: 16, color: colors.text },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, backgroundColor: colors.surface },
  save: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.brand, borderRadius: 10 },
  saveText: { color: "#fff", fontWeight: "600" },
});
