import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { staffApi } from "../../lib/api";
import { STAFF_POLL_MS, useStaffStore } from "../../lib/staff-hooks";
import { colors } from "../../lib/theme";

const topics = { find_item: "Can't find an item", price: "Price question", stock: "Out of stock", other: "Something else" };
const minutesAgo = (iso: string) => {
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? "just now" : `${m} min ago`;
};

/** Shoppers who tapped Call for help, nearest aisle first. "On my way" tells them your name. */
export default function StaffHelp() {
  const storeId = useStaffStore();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const help = useQuery({ queryKey: ["staff-help", storeId], queryFn: () => staffApi.help(storeId), refetchInterval: STAFF_POLL_MS });

  const act = async (id: string, action: "acknowledge" | "resolve") => {
    setBusy(id + action);
    try {
      await staffApi.helpAction(storeId, id, action);
      await queryClient.invalidateQueries({ queryKey: ["staff-help", storeId] });
    } finally {
      setBusy(null);
    }
  };

  return (
    <FlatList
      data={help.data ?? []}
      keyExtractor={(h) => h.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>{help.isPending ? "Loading…" : "Nobody is waiting for help."}</Text>}
      renderItem={({ item: h }) => (
        <View style={[styles.card, h.status === "open" && styles.open]}>
          <Text style={styles.aisle}>{h.aisle ? `Aisle ${h.aisle}` : "Aisle unknown"}</Text>
          <Text style={styles.muted}>
            {h.shopperName ?? "Shopper"}
            {h.cartId ? ` · cart ${h.cartId}` : ""} · {minutesAgo(h.createdAt)}
          </Text>
          <Text style={styles.topic}>
            {topics[h.topic]}
            {h.note ? ` · “${h.note}”` : ""}
          </Text>
          {h.status === "acknowledged" && <Text style={styles.muted}>{h.staffName ?? "Someone"} is on the way</Text>}
          <View style={styles.actions}>
            {h.status === "open" && (
              <Button title="I'm on my way" busy={busy === h.id + "acknowledge"} onPress={() => void act(h.id, "acknowledge")} style={{ flex: 1 }} />
            )}
            <Button title="Resolved" variant="secondary" busy={busy === h.id + "resolve"} onPress={() => void act(h.id, "resolve")} style={{ flex: 1 }} />
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 4 },
  open: { borderColor: "#FB923C" },
  aisle: { fontSize: 24, fontWeight: "700", color: colors.text },
  topic: { fontSize: 15, fontWeight: "600", color: colors.text },
  muted: { color: colors.muted },
  actions: { flexDirection: "row", gap: 8, marginTop: 8 },
  empty: { color: colors.muted, textAlign: "center", marginTop: 32 },
});
