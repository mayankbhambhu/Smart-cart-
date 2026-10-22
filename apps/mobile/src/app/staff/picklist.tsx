import type { Reservation } from "@smart-cart/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "../../components/Button";
import { ApiError, staffApi } from "../../lib/api";
import { STAFF_POLL_MS, useStaffStore } from "../../lib/staff-hooks";
import { slotLabel } from "../../lib/team-logic";
import { colors } from "../../lib/theme";

/** Reservations to pick, earliest slot first. Items are in walking order; park the cart when done. */
export default function PickList() {
  const storeId = useStaffStore();
  const list = useQuery({ queryKey: ["picklist", storeId], queryFn: () => staffApi.pickList(storeId), refetchInterval: STAFF_POLL_MS });
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = list.data ?? [];
  const open = rows.find((r) => r.id === openId);

  if (open) return <PickOne reservation={open} onDone={() => setOpenId(null)} />;
  return (
    <ScrollView contentContainerStyle={styles.body}>
      {rows.length === 0 && <Text style={styles.empty}>{list.isPending ? "Loading…" : "No reservations to pick."}</Text>}
      {rows.map((r) => (
        <Pressable key={r.id} accessibilityRole="button" onPress={() => setOpenId(r.id)} style={[styles.card, r.status === "picked" && styles.done]}>
          <Text style={styles.title}>{slotLabel(r.slotStart, r.slotEnd)}</Text>
          <Text style={styles.muted}>
            {r.shopperName ?? "Shopper"} · {r.itemCount} {r.itemCount === 1 ? "item" : "items"}
          </Text>
          <Text style={r.status === "picked" ? styles.ok : styles.todo}>
            {r.status === "picked" ? `Parked in cart ${r.cartCode} by ${r.pickedBy ?? "staff"}` : "To pick ›"}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function PickOne({ reservation: r, onDone }: { reservation: Reservation; onDone: () => void }) {
  const storeId = useStaffStore();
  const queryClient = useQueryClient();
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [cart, setCart] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allTicked = r.items.every((i) => ticked[i.productId]);

  const park = async () => {
    setBusy(true);
    setError(null);
    try {
      await staffApi.picked(storeId, r.id, cart.trim().toUpperCase());
      await queryClient.invalidateQueries({ queryKey: ["picklist", storeId] });
      onDone();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setError(
        code === "cart_in_use"
          ? "That cart is in use. Take a free cart and enter its number."
          : code === "cart_not_found"
            ? "No cart with that number. It looks like C-0016."
            : code === "reservation_not_open"
              ? "Someone else already picked this one."
              : "Could not save. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.title}>{r.shopperName ?? "Shopper"}</Text>
      <Text style={styles.muted}>Pickup {slotLabel(r.slotStart, r.slotEnd)} · tick each item as it goes in the cart</Text>
      {r.items.map((i) => {
        const on = Boolean(ticked[i.productId]) || r.status === "picked";
        return (
          <Pressable
            key={i.productId}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            onPress={() => setTicked((t) => ({ ...t, [i.productId]: !t[i.productId] }))}
            style={[styles.item, on && styles.itemOn]}
          >
            <Text style={styles.check}>{on ? "☑" : "☐"}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>
                {i.qty} × {i.name}
              </Text>
              <Text style={styles.muted}>{i.aisle ? `Aisle ${i.aisle}, shelf ${i.shelf}` : "Location not mapped"}</Text>
            </View>
          </Pressable>
        );
      })}
      {r.status === "reserved" && (
        <>
          <Text style={styles.label}>Cart you parked it in</Text>
          <TextInput value={cart} onChangeText={setCart} placeholder="C-0016" autoCapitalize="characters" style={styles.input} accessibilityLabel="Cart number" />
          {error && <Text style={styles.error}>{error}</Text>}
          <Button title="Picked and parked" busy={busy} disabled={!allTicked || !/^c-?\d{4}$/i.test(cart.trim())} onPress={() => void park()} />
        </>
      )}
      <Button title="Back to the list" variant="secondary" onPress={onDone} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 2 },
  done: { opacity: 0.7 },
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  muted: { color: colors.muted },
  ok: { color: colors.brand, fontWeight: "600", marginTop: 4 },
  todo: { color: "#C2410C", fontWeight: "600", marginTop: 4 },
  item: { flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border },
  itemOn: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  check: { fontSize: 22, color: colors.brand },
  itemName: { fontSize: 15, fontWeight: "600", color: colors.text },
  label: { fontWeight: "600", color: colors.text, marginTop: 6 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, minHeight: 48, fontSize: 16, backgroundColor: colors.surface },
  error: { color: colors.danger, backgroundColor: colors.dangerSoft, borderRadius: 10, padding: 10 },
  empty: { color: colors.muted, textAlign: "center", marginTop: 32 },
});
