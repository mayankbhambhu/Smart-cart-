import type { DietTag } from "@smart-cart/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { HelpBanner } from "../components/HelpBanner";
import { ProductResult } from "../components/ProductResult";
import { api } from "../lib/api";
import { useAssist } from "../lib/assist-store";
import { colors } from "../lib/theme";

const DIETS: { tag: DietTag; label: string }[] = [
  { tag: "veg", label: "Veg" },
  { tag: "jain", label: "Jain" },
  { tag: "no_added_sugar", label: "No added sugar" },
];


/** US-02, US-03, US-04, US-05: find a product's aisle and shelf, filter by diet, compare per kg. */
export default function FindScreen() {
  const storeId = useAssist((s) => s.storeId);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  // Starts from the shopper's saved diet preference.
  const [diet, setDiet] = useState<DietTag[]>(() => useAssist.getState().dietPref);

  // Search as the shopper types, after a short pause.
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const results = useQuery({
    queryKey: ["search", storeId, query, diet],
    queryFn: () => api.search(storeId, query, diet),
    enabled: query.length > 0,
  });

  const toggle = (tag: DietTag) => setDiet((d) => (d.includes(tag) ? d.filter((x) => x !== tag) : [...d, tag]));

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Search: haldi, toor dal, shampoo…"
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          style={styles.input}
          accessibilityLabel="Search products"
        />
        <View style={styles.chips}>
          {DIETS.map((d) => {
            const on = diet.includes(d.tag);
            return (
              <Pressable
                key={d.tag}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => toggle(d.tag)}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{d.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {query.length === 0 ? (
        <View style={styles.hint}>
          <Text style={styles.muted}>Type what you need. You can use Hindi words like haldi, chawal or doodh.</Text>
          <Text style={styles.muted}>Results show the aisle and shelf, whether it is in stock, and the price per kg or litre so you can compare brands.</Text>
        </View>
      ) : results.isPending ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />
      ) : results.isError ? (
        <Text style={[styles.muted, styles.pad]}>Could not search right now. Check your connection.</Text>
      ) : (
        <FlatList
          data={results.data}
          keyExtractor={(r) => r.productId}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => (
            <ProductResult product={item} badge={index === 0 && results.data.length > 1 && item.unitPricePaise ? "BEST VALUE PER " + (item.unit ?? "").toUpperCase() : undefined} />
          )}
          ListEmptyComponent={
            <View style={{ gap: 12 }}>
              <Text style={styles.muted}>
                We couldn't find “{query}” in this store. We have noted it for the store team.
              </Text>
              <HelpBanner />
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  head: { padding: 16, gap: 10, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, backgroundColor: colors.background },
  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.text },
  chipTextOn: { color: "#fff", fontWeight: "600" },
  list: { padding: 16, gap: 10 },
  hint: { padding: 16, gap: 8 },
  muted: { color: colors.muted, lineHeight: 20 },
  pad: { padding: 16 },
});
