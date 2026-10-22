import { router, type Href } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../lib/theme";

const TILES: { href: Href; icon: string; title: string; sub: string }[] = [
  { href: "/find", icon: "🔎", title: "Find", sub: "Aisle, shelf, stock" },
  { href: "/list", icon: "📝", title: "Smart list", sub: "Shortest route" },
  { href: "/ask", icon: "💬", title: "Ask", sub: "SmartCart AI" },
];

/** Shortcuts to the milestone 4 tools, on the home and cart screens. */
export function FindItFast() {
  return (
    <View style={styles.row}>
      {TILES.map((t) => (
        <Pressable
          key={t.title}
          accessibilityRole="button"
          onPress={() => router.push(t.href)}
          style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.icon}>{t.icon}</Text>
          <Text style={styles.title}>{t.title}</Text>
          <Text style={styles.sub}>{t.sub}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, backgroundColor: colors.surface, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: colors.border, gap: 2 },
  icon: { fontSize: 22 },
  title: { fontSize: 15, fontWeight: "600", color: colors.text },
  sub: { fontSize: 12, color: colors.muted },
});
