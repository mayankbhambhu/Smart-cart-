import type { StaffTask } from "@smart-cart/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "../../components/Button";
import { staffApi } from "../../lib/api";
import { STAFF_POLL_MS, useStaffStore } from "../../lib/staff-hooks";
import { taskIcon } from "../../lib/team-logic";
import { colors } from "../../lib/theme";

/** Open tasks for me or for anyone: restocks, stock counts, other jobs. Picks live on the pick list. */
export default function StaffTasks() {
  const storeId = useStaffStore();
  const tasks = useQuery({ queryKey: ["staff-tasks", storeId], queryFn: () => staffApi.tasks(storeId), refetchInterval: STAFF_POLL_MS });
  const rows = (tasks.data ?? []).filter((t) => t.type !== "pick");
  return (
    <FlatList
      data={rows}
      keyExtractor={(t) => t.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>{tasks.isPending ? "Loading…" : "No open tasks. Nice."}</Text>}
      renderItem={({ item }) => <TaskCard task={item} />}
    />
  );
}

function TaskCard({ task: t }: { task: StaffTask }) {
  const storeId = useStaffStore();
  const queryClient = useQueryClient();
  const [restocked, setRestocked] = useState("");
  const [busy, setBusy] = useState(false);

  const done = async () => {
    setBusy(true);
    try {
      await staffApi.taskDone(storeId, t.id, t.type === "restock" ? Number(restocked) || undefined : undefined);
      await queryClient.invalidateQueries({ queryKey: ["staff-tasks", storeId] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        {taskIcon[t.type]} {t.title}
      </Text>
      {t.note && <Text style={styles.muted}>{t.note}</Text>}
      <Text style={styles.muted}>{t.assignedName ? `Assigned to ${t.assignedName}` : "Anyone can take this"}</Text>
      {t.type === "restock" && (
        <TextInput
          value={restocked}
          onChangeText={setRestocked}
          placeholder="Units put on the shelf from the back room"
          keyboardType="number-pad"
          style={styles.input}
          accessibilityLabel="Units restocked"
        />
      )}
      {t.type === "stock_check" ? (
        <Button title="Count it now" onPress={() => router.push("/staff/stock")} />
      ) : (
        <Button title="Done" busy={busy} onPress={() => void done()} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 6 },
  title: { fontSize: 16, fontWeight: "600", color: colors.text },
  muted: { color: colors.muted },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, minHeight: 44, fontSize: 15, backgroundColor: colors.surface },
  empty: { color: colors.muted, textAlign: "center", marginTop: 32 },
});
