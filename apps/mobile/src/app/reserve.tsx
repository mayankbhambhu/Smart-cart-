import type { Reservation } from "@smart-cart/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../components/Button";
import { FoodMark } from "../components/FoodMark";
import { QtyStepper } from "../components/QtyStepper";
import { ApiError, api } from "../lib/api";
import { useAssist } from "../lib/assist-store";
import { useCart } from "../lib/cart-store";
import { formatInr } from "../lib/money";
import { useReserve } from "../lib/reserve-store";
import { reservationStatusLabel, slotLabel } from "../lib/team-logic";
import { colors } from "../lib/theme";

const ACTIVE: Reservation["status"][] = ["reserved", "picked"];

/** Reserve for pickup: hold items for a half-hour slot; staff pick them into a cart for you. */
export default function ReserveScreen() {
  const storeId = useAssist((s) => s.storeId);
  const mine = useQuery({
    queryKey: ["reservation", storeId],
    queryFn: () => api.myReservation(storeId),
    refetchInterval: (q) => (q.state.data && ACTIVE.includes(q.state.data.status) ? 5_000 : false),
  });

  if (mine.isPending) return <ActivityIndicator color={colors.brand} style={{ marginTop: 32 }} />;
  if (mine.data && ACTIVE.includes(mine.data.status)) return <ReservationStatus reservation={mine.data} />;
  return <NewReservation last={mine.data ?? null} />;
}

function NewReservation({ last }: { last: Reservation | null }) {
  const storeId = useAssist((s) => s.storeId);
  const queryClient = useQueryClient();
  const { qty, products, set, clear } = useReserve();
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slots = useQuery({ queryKey: ["slots", storeId], queryFn: () => api.slots(storeId) });
  const lines = Object.entries(qty).map(([id, n]) => ({ product: products[id]!, qty: n }));
  const total = lines.reduce((sum, l) => sum + l.product.pricePaise * l.qty, 0);

  useEffect(() => {
    if (!slot && slots.data?.[0]) setSlot(slots.data[0].start);
  }, [slots.data, slot]);

  const reserve = async () => {
    if (!slot || lines.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.reserve(storeId, lines.map((l) => ({ productId: l.product.productId, qty: l.qty })), slot);
      clear();
      await queryClient.invalidateQueries({ queryKey: ["reservation", storeId] });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      if (code === "not_enough_stock" && e instanceof ApiError) {
        const name = products[String(e.details.productId)]?.name ?? "One item";
        setError(`${name}: only ${Number(e.details.available ?? 0)} left to reserve. Lower the quantity and try again.`);
      } else if (code === "reservation_exists") {
        setError("You already have a reservation. Collect or cancel it first.");
      } else if (code === "invalid_slot") {
        setError("That pickup slot has passed. Choose another.");
        void slots.refetch();
      } else {
        setError("Could not reserve. Check your connection and try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {last && !ACTIVE.includes(last.status) && last.status !== "collected" && (
        <Text style={styles.muted}>Your last reservation was {last.status}.</Text>
      )}
      <Text style={styles.big}>Reserve for pickup</Text>
      <Text style={styles.muted}>
        We hold the items for you and a staff member picks them into a cart. Nothing is charged now: you pay in the app
        when you collect. Items are held until one hour after your slot.
      </Text>

      {lines.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.muted}>Nothing added yet.</Text>
        </View>
      ) : (
        <View style={styles.card}>
          {lines.map((l) => (
            <View key={l.product.productId} style={styles.line}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name}>{l.product.name}</Text>
                <View style={styles.inline}>
                  <FoodMark type={l.product.foodType} withText={false} />
                  <Text style={styles.muted}>{formatInr(l.product.pricePaise)} each</Text>
                </View>
              </View>
              <QtyStepper qty={l.qty} onChange={(q) => set(l.product, q)} />
            </View>
          ))}
          <Text style={styles.total}>Estimated total {formatInr(total)}</Text>
        </View>
      )}
      <Button title="Add items by section" variant="secondary" onPress={() => router.push("/browse")} />

      <Text style={styles.section}>Pickup slot</Text>
      {slots.isPending ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <View style={styles.slots}>
          {slots.data?.map((s) => {
            const on = slot === s.start;
            return (
              <Pressable
                key={s.start}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => setSlot(s.start)}
                style={[styles.slot, on && styles.slotOn]}
              >
                <Text style={[styles.slotText, on && { color: colors.brand }]}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      <Button title="Reserve" busy={busy} disabled={!slot || lines.length === 0} onPress={() => void reserve()} />
    </ScrollView>
  );
}

function ReservationStatus({ reservation: r }: { reservation: Reservation }) {
  const storeId = useAssist((s) => s.storeId);
  const queryClient = useQueryClient();
  const adopt = useCart((s) => s.adopt);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = r.status === "picked";

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "reservation_not_ready"
          ? "Not picked yet. We'll show it here as soon as it's ready."
          : "Could not reach the store. Try again.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <View style={[styles.status, ready && styles.statusReady]}>
        <Text style={styles.big}>{ready ? `Ready in cart ${r.cartCode}` : reservationStatusLabel[r.status]}</Text>
        <Text style={styles.muted}>
          Pickup {slotLabel(r.slotStart, r.slotEnd)}
          {ready
            ? `. ${r.pickedBy ?? "A staff member"} has parked it at the pickup point. Tap Collect when you're at the cart.`
            : ". A floor assistant will pick these for you; this page updates by itself."}
        </Text>
      </View>
      <View style={styles.card}>
        {r.items.map((i) => (
          <View key={i.productId} style={styles.line}>
            <Text style={[styles.name, { flex: 1 }]}>
              {i.qty} × {i.name}
            </Text>
            <Text style={styles.muted}>{i.aisle ? `Aisle ${i.aisle}` : ""}</Text>
          </View>
        ))}
        <Text style={styles.total}>
          {r.itemCount} {r.itemCount === 1 ? "item" : "items"} · {formatInr(r.totalPaise)}
        </Text>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      {ready && (
        <Button
          title={`Collect cart ${r.cartCode}`}
          busy={busy === "collect"}
          onPress={() =>
            void act("collect", async () => {
              const res = await api.collect(storeId, r.id);
              adopt(res.cart);
              await queryClient.invalidateQueries({ queryKey: ["reservation", storeId] });
              router.replace("/cart");
            })
          }
        />
      )}
      <Button
        title="Cancel reservation"
        variant="secondary"
        busy={busy === "cancel"}
        onPress={() =>
          void act("cancel", async () => {
            await api.cancelReservation(storeId, r.id);
            await queryClient.invalidateQueries({ queryKey: ["reservation", storeId] });
          })
        }
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  big: { fontSize: 20, fontWeight: "700", color: colors.text },
  section: { fontSize: 16, fontWeight: "600", color: colors.text, marginTop: 4 },
  muted: { color: colors.muted, lineHeight: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 10 },
  line: { flexDirection: "row", alignItems: "center", gap: 10 },
  inline: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { fontSize: 15, fontWeight: "600", color: colors.text },
  total: { fontWeight: "700", color: colors.text, textAlign: "right" },
  slots: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  slot: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surface },
  slotOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  slotText: { color: colors.text, fontWeight: "500" },
  status: { backgroundColor: "#FEF3C7", borderRadius: 16, padding: 16, gap: 6 },
  statusReady: { backgroundColor: colors.brandSoft },
  error: { color: colors.danger, backgroundColor: colors.dangerSoft, borderRadius: 10, padding: 10 },
});
