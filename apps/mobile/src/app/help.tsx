import type { HelpTopic } from "@smart-cart/contracts";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "../components/Button";
import { useAssist } from "../lib/assist-store";
import { colors } from "../lib/theme";

const TOPICS: { topic: HelpTopic; label: string }[] = [
  { topic: "find_item", label: "Can't find an item" },
  { topic: "price", label: "Price question" },
  { topic: "stock", label: "Item out of stock" },
  { topic: "other", label: "Something else" },
];

/** US-07: call a floor assistant. Staff see the request with the aisle of your last scan (US-09). */
export default function HelpScreen() {
  const { help, callHelp, cancelHelp, refreshHelp } = useAssist();
  const [topic, setTopic] = useState<HelpTopic>("find_item");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const active = help && (help.status === "open" || help.status === "acknowledged");

  // Live help events come over the cart connection; a shopper without a cart gets updates by polling.
  useEffect(() => {
    refreshHelp().catch(() => {});
    if (!active) return;
    const timer = setInterval(() => refreshHelp().catch(() => {}), 5_000);
    return () => clearInterval(timer);
  }, [refreshHelp, active]);

  const run = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch {
      Alert.alert("Could not reach the store", "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (active) {
    return (
      <View style={styles.body}>
        <View style={styles.statusCard}>
          <Text style={styles.big}>
            {help.status === "open" ? "Help requested" : `${help.staffName ?? "A staff member"} is on the way`}
          </Text>
          <Text style={styles.muted}>
            {help.aisle ? `We told them you're near aisle ${help.aisle}. ` : "Stay where you are. "}
            {help.status === "open" ? "The next free floor assistant will come to you." : "They've seen your request."}
          </Text>
          {help.note && <Text style={styles.note}>“{help.note}”</Text>}
        </View>
        <Button title="I don't need help any more" variant="secondary" busy={busy} onPress={() => void run(cancelHelp)()} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      {help?.status === "resolved" && <Text style={styles.done}>✓ Your last request was resolved.</Text>}
      <Text style={styles.big}>What do you need help with?</Text>
      {TOPICS.map((t) => (
        <Pressable
          key={t.topic}
          accessibilityRole="radio"
          accessibilityState={{ selected: topic === t.topic }}
          onPress={() => setTopic(t.topic)}
          style={[styles.option, topic === t.topic && styles.optionOn]}
        >
          <Text style={[styles.optionText, topic === t.topic && { color: colors.brand }]}>{t.label}</Text>
        </Pressable>
      ))}
      <TextInput
        value={note}
        onChangeText={setNote}
        maxLength={200}
        placeholder="Add a note (optional), e.g. jeera 100 g"
        style={styles.input}
        accessibilityLabel="Note for staff"
      />
      <Button title="Call a staff member" busy={busy} onPress={() => void run(() => callHelp(topic, note))()} />
      <Text style={styles.muted}>Staff see the aisle of the last item you scanned, so they can find you.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  big: { fontSize: 20, fontWeight: "700", color: colors.text },
  muted: { color: colors.muted, lineHeight: 20 },
  note: { color: colors.text, fontStyle: "italic" },
  done: { color: colors.brand, fontWeight: "600" },
  statusCard: { backgroundColor: colors.brandSoft, borderRadius: 16, padding: 18, gap: 8 },
  option: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 12, padding: 14 },
  optionOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  optionText: { fontSize: 16, color: colors.text, fontWeight: "500" },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, fontSize: 16, backgroundColor: colors.surface },
});
