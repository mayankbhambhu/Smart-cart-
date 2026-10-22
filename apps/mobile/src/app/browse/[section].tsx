import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { DietPrefChips } from "../../components/DietPrefChips";
import { ProductResult } from "../../components/ProductResult";
import { QtyStepper } from "../../components/QtyStepper";
import { ReserveBar } from "../../components/ReserveBar";
import { api } from "../../lib/api";
import { useAssist } from "../../lib/assist-store";
import { useReserve } from "../../lib/reserve-store";
import { colors } from "../../lib/theme";

/** One section's products, category by category, filtered by the shopper's diet preference. */
export default function SectionScreen() {
  const { section, name } = useLocalSearchParams<{ section: string; name?: string }>();
  const storeId = useAssist((s) => s.storeId);
  const diet = useAssist((s) => s.dietPref);
  const [category, setCategory] = useState<string | null>(null);
  const reserveQty = useReserve((s) => s.qty);
  const setReserve = useReserve((s) => s.set);

  const sections = useQuery({ queryKey: ["sections", storeId], queryFn: () => api.sections(storeId) });
  const info = sections.data?.find((s) => s.id === section);
  const products = useQuery({
    queryKey: ["browse", storeId, section, category, diet],
    queryFn: () => api.browse(storeId, { section: category ? undefined : section, category: category ?? undefined, tags: diet }),
  });

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: info?.name ?? name ?? "Section" }} />
      <View style={styles.head}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {[{ id: null as string | null, name: "All" }, ...(info?.categories.filter((c) => c.productCount > 0) ?? [])].map((c) => {
            const on = category === c.id;
            return (
              <Pressable
                key={c.id ?? "all"}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => setCategory(c.id)}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && { color: colors.brand }]}>{c.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <DietPrefChips />
      </View>
      {products.isPending ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />
      ) : products.isError ? (
        <Text style={styles.empty}>Could not load products. Pull back and try again.</Text>
      ) : (
        <FlatList
          data={products.data}
          keyExtractor={(p) => p.productId}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {diet.length ? "Nothing here matches your diet preference." : "No products in this section yet."}
            </Text>
          }
          renderItem={({ item, index }) => (
            <View style={{ gap: 6 }}>
              {(index === 0 || products.data[index - 1]!.category !== item.category) && !category && (
                <Text style={styles.category}>{item.category}</Text>
              )}
              <ProductResult product={item}>
                {item.stock !== "out" && (
                  <QtyStepper qty={reserveQty[item.productId] ?? 0} onChange={(q) => setReserve(item, q)} />
                )}
              </ProductResult>
            </View>
          )}
        />
      )}
      <ReserveBar />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { padding: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  chips: { gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  chipText: { color: colors.text, fontWeight: "500" },
  list: { padding: 12, gap: 10 },
  category: { fontSize: 13, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 6 },
  empty: { color: colors.muted, textAlign: "center", marginTop: 32, paddingHorizontal: 24 },
});
