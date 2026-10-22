import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "../components/Button";
import { HelpBanner } from "../components/HelpBanner";
import { parseListText, stockLabel, whereLabel } from "../lib/assist-logic";
import { useAssist } from "../lib/assist-store";
import { formatInr } from "../lib/money";
import { colors } from "../lib/theme";

/** US-01, US-06: a shopping list sorted into a walking route, aisle by aisle. */
export default function SmartListScreen() {
  const { listText, setListText, route, planRoute, picked, togglePicked } = useAssist();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(route === null);

  const plan = async () => {
    const lines = parseListText(listText);
    if (lines.length === 0) return;
    setBusy(true);
    try {
      await planRoute(lines);
      setEditing(false);
    } catch {
      Alert.alert("Could not plan the route", "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (editing || !route) {
    return (
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Your shopping list</Text>
        <Text style={styles.muted}>Type or paste it, one item per line. We'll sort it into the shortest walk through the store.</Text>
        <TextInput
          multiline
          value={listText}
          onChangeText={setListText}
          placeholder={"toor dal 1 kg\nhaldi\ndoodh\natta 5 kg\nshampoo"}
          style={styles.textarea}
          textAlignVertical="top"
          accessibilityLabel="Shopping list"
        />
        <Button title="Plan my route" busy={busy} disabled={parseListText(listText).length === 0} onPress={() => void plan()} />
      </ScrollView>
    );
  }

  const done = Object.keys(picked).length;
  return (
    <ScrollView contentContainerStyle={styles.body}>
      <View style={styles.summary}>
        <Text style={styles.title}>
          {route.stops.length} {route.stops.length === 1 ? "stop" : "stops"} · {done}/{route.matched} picked
        </Text>
        <Pressable accessibilityRole="button" onPress={() => setEditing(true)}>
          <Text style={styles.link}>Edit list</Text>
        </Pressable>
      </View>

      {route.stops.map((stop, i) => (
        <View key={stop.aisle} style={styles.stop}>
          <View style={styles.stopHead}>
            <Text style={styles.stopNo}>{i + 1}</Text>
            <Text style={styles.stopTitle}>
              Aisle {stop.aisle} · {stop.category}
            </Text>
          </View>
          {stop.items.map(({ line, product, alternatives }) => {
            const on = !!picked[product.productId];
            return (
              <Pressable
                key={product.productId}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => togglePicked(product.productId)}
                style={styles.item}
              >
                <View style={[styles.box, on && styles.boxOn]}>{on && <Text style={styles.tick}>✓</Text>}</View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemName, on && styles.struck]}>{product.name}</Text>
                  <Text style={styles.muted}>
                    “{line}” · {whereLabel(product)} · {stockLabel[product.stock]}
                    {alternatives > 0 ? ` · ${alternatives} other option${alternatives > 1 ? "s" : ""}` : ""}
                  </Text>
                </View>
                <Text style={styles.price}>{formatInr(product.pricePaise)}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}

      {route.notFound.length > 0 && (
        <View style={styles.missing}>
          <Text style={styles.stopTitle}>Not found in this store</Text>
          <Text style={styles.muted}>{route.notFound.join(", ")}</Text>
          <HelpBanner compact />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  muted: { color: colors.muted, lineHeight: 20 },
  textarea: { minHeight: 200, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, fontSize: 16, backgroundColor: colors.surface },
  summary: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  link: { color: colors.brand, fontWeight: "600" },
  stop: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  stopHead: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: colors.brandSoft },
  stopNo: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.brand, color: "#fff", textAlign: "center", lineHeight: 26, fontWeight: "700", overflow: "hidden" },
  stopTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  item: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderTopWidth: 1, borderColor: colors.border },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  tick: { color: "#fff", fontWeight: "700" },
  itemName: { fontSize: 15, fontWeight: "600", color: colors.text },
  struck: { textDecorationLine: "line-through", color: colors.muted },
  price: { fontWeight: "600", color: colors.text },
  missing: { gap: 8, padding: 12, backgroundColor: "#FFF7ED", borderRadius: 14 },
});
