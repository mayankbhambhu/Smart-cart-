import type { SecurityAlert } from "@smart-cart/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { staffApi } from "../../lib/api";
import { alertAdvice, alertTitle } from "../../lib/security-logic";
import { STAFF_POLL_MS, useStaffStore } from "../../lib/staff-hooks";
import { colors } from "../../lib/theme";

const minutesAgo = (iso: string) => {
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? "just now" : `${m} min ago`;
};

/** Carts to check on the floor. Staff decide what happened; the app only says where to look. */
export default function StaffSecurity() {
  const storeId = useStaffStore();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const alerts = useQuery({ queryKey: ["staff-security", storeId], queryFn: () => staffApi.security(storeId), refetchInterval: STAFF_POLL_MS });

  const act = async (a: SecurityAlert, action: "acknowledge" | "resolve" | "false_alarm") => {
    setBusy(a.id + action);
    try {
      await staffApi.securityAction(storeId, a.id, action);
      await queryClient.invalidateQueries({ queryKey: ["staff-security", storeId] });
    } finally {
      setBusy(null);
    }
  };

  return (
    <FlatList
      data={alerts.data ?? []}
      keyExtractor={(a) => a.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>{alerts.isPending ? "Loading…" : "No carts need a check."}</Text>}
      renderItem={({ item: a }) => (
        <View style={[styles.card, a.status === "open" && styles.open]}>
          <Text style={styles.title}>{alertTitle(a)}</Text>
          <Text style={styles.muted}>
            {a.shopperName ?? "Shopper"}
            {a.aisle && a.aisle !== "EXIT" ? ` · aisle ${a.aisle}` : ""} · {minutesAgo(a.createdAt)}
          </Text>
          <Text style={styles.advice}>{alertAdvice(a)}</Text>
          {a.status === "acknowledged" && <Text style={styles.muted}>{a.handledBy ?? "Someone"} is on it</Text>}
          <View style={styles.actions}>
            {a.status === "open" && (
              <Button title="I'm on it" busy={busy === a.id + "acknowledge"} onPress={() => void act(a, "acknowledge")} style={{ flex: 1 }} />
            )}
            <Button title="Checked" variant="secondary" busy={busy === a.id + "resolve"} onPress={() => void act(a, "resolve")} style={{ flex: 1 }} />
          </View>
          <Button title="False alarm" variant="secondary" busy={busy === a.id + "false_alarm"} onPress={() => void act(a, "false_alarm")} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 4 },
  open: { borderColor: "#F87171" },
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  advice: { color: colors.text, marginTop: 2 },
  muted: { color: colors.muted },
  actions: { flexDirection: "row", gap: 8, marginTop: 8 },
  empty: { color: colors.muted, textAlign: "center", marginTop: 32 },
});
