import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";
import { api } from "../lib/api";
import { useAssist } from "../lib/assist-store";
import { slotLabel } from "../lib/team-logic";
import { colors } from "../lib/theme";

/** Home screen entry to Reserve for pickup, showing the active reservation if there is one. */
export function ReservationCard() {
  const storeId = useAssist((s) => s.storeId);
  const mine = useQuery({
    queryKey: ["reservation", storeId],
    queryFn: () => api.myReservation(storeId),
    refetchInterval: 15_000,
  });
  const r = mine.data;
  const active = r && (r.status === "reserved" || r.status === "picked");
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push("/reserve")}
      style={[styles.card, active && r.status === "picked" && styles.ready]}
    >
      <Text style={styles.title}>
        {active ? (r.status === "picked" ? `🧺 Ready in cart ${r.cartCode}` : "🧺 Reservation on hold") : "🧺 Reserve for pickup"}
      </Text>
      <Text style={styles.sub}>
        {active
          ? `${r.itemCount} ${r.itemCount === 1 ? "item" : "items"} · pickup ${slotLabel(r.slotStart, r.slotEnd)}`
          : "Hold items now, staff pick them, collect and pay later"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 2 },
  ready: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  title: { fontSize: 16, fontWeight: "600", color: colors.text },
  sub: { color: colors.muted },
});
