import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { DietPrefChips } from "../../components/DietPrefChips";
import { ReserveBar } from "../../components/ReserveBar";
import { api } from "../../lib/api";
import { useAssist } from "../../lib/assist-store";
import { colors } from "../../lib/theme";

/** Shop by section: Fruits, Vegetables, Dairy and eggs, Meat and fish, Staples, ... */
export default function BrowseScreen() {
  const storeId = useAssist((s) => s.storeId);
  const sections = useQuery({ queryKey: ["sections", storeId], queryFn: () => api.sections(storeId) });

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body}>
        <DietPrefChips />
        {sections.isPending ? (
          <ActivityIndicator color={colors.brand} />
        ) : sections.isError ? (
          <View style={styles.card}>
            <Text>Could not load the store's sections.</Text>
            <Button title="Try again" variant="secondary" onPress={() => void sections.refetch()} style={{ marginTop: 12 }} />
          </View>
        ) : (
          <View style={styles.grid}>
            {sections.data
              .filter((s) => s.productCount > 0)
              .map((s) => (
                <Pressable
                  key={s.id}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: "/browse/[section]", params: { section: s.id, name: s.name } })}
                  style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
                >
                  <Text style={styles.icon}>{s.icon}</Text>
                  <Text style={styles.name}>{s.name}</Text>
                  <Text style={styles.count}>
                    {s.productCount} {s.productCount === 1 ? "product" : "products"}
                  </Text>
                </Pressable>
              ))}
          </View>
        )}
      </ScrollView>
      <ReserveBar />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
  },
  icon: { fontSize: 28 },
  name: { fontSize: 16, fontWeight: "600", color: colors.text },
  count: { fontSize: 12, color: colors.muted },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border },
});
