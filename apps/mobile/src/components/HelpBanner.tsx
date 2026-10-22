import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAssist } from "../lib/assist-store";
import { colors } from "../lib/theme";

/** Shows where the shopper's help request stands, or a button to call for help. */
export function HelpBanner({ compact }: { compact?: boolean }) {
  const help = useAssist((s) => s.help);
  const active = help && (help.status === "open" || help.status === "acknowledged");

  if (!active) {
    return (
      <Pressable accessibilityRole="button" onPress={() => router.push("/help")} style={[styles.call, compact && styles.compact]}>
        <Text style={styles.callText}>🙋 Call for help</Text>
        {!compact && <Text style={styles.muted}>A staff member comes to you</Text>}
      </Pressable>
    );
  }
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push("/help")} style={[styles.status, compact && styles.compact]}>
      <View style={[styles.dot, { backgroundColor: help.status === "open" ? "#F59E0B" : colors.brand }]} />
      <Text style={styles.statusText}>
        {help.status === "open"
          ? "Help requested. Finding a staff member…"
          : `${help.staffName ?? "A staff member"} is on the way`}
        {help.aisle ? ` · Aisle ${help.aisle}` : ""}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  call: { backgroundColor: "#FFF7ED", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#FED7AA" },
  compact: { padding: 10 },
  callText: { fontSize: 16, fontWeight: "600", color: "#9A3412" },
  muted: { color: colors.muted, marginTop: 2 },
  status: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandSoft, borderRadius: 14, padding: 14 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { flex: 1, color: colors.text, fontWeight: "600" },
});
