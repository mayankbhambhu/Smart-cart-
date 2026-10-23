import { useQuery } from "@tanstack/react-query";
import { router, type Href } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { staffApi } from "../../lib/api";
import { useAuth } from "../../lib/auth-store";
import { STAFF_POLL_MS, useStaffStore } from "../../lib/staff-hooks";
import { roleLabel } from "../../lib/team-logic";
import { colors } from "../../lib/theme";

/** Staff mode on the handheld: what needs doing on the floor right now. */
export default function StaffHome() {
  const session = useAuth((s) => s.session);
  const signOut = useAuth((s) => s.signOut);
  const storeId = useStaffStore();
  const help = useQuery({ queryKey: ["staff-help", storeId], queryFn: () => staffApi.help(storeId), refetchInterval: STAFF_POLL_MS });
  const picks = useQuery({ queryKey: ["picklist", storeId], queryFn: () => staffApi.pickList(storeId), refetchInterval: STAFF_POLL_MS });
  const tasks = useQuery({ queryKey: ["staff-tasks", storeId], queryFn: () => staffApi.tasks(storeId), refetchInterval: STAFF_POLL_MS });
  const security = useQuery({ queryKey: ["staff-security", storeId], queryFn: () => staffApi.security(storeId), refetchInterval: STAFF_POLL_MS });

  const waiting = help.data?.filter((h) => h.status === "open").length ?? 0;
  const toPick = picks.data?.filter((r) => r.status === "reserved").length ?? 0;
  const openTasks = tasks.data?.filter((t) => t.type !== "pick").length ?? 0;
  const toCheck = security.data?.filter((a) => a.status === "open").length ?? 0;
  const tiles: { href: Href; icon: string; title: string; sub: string; count?: number; urgent?: boolean }[] = [
    { href: "/staff/help", icon: "🙋", title: "Help requests", sub: waiting ? `${waiting} waiting` : "Nobody waiting", count: waiting, urgent: waiting > 0 },
    { href: "/staff/security", icon: "🛡️", title: "Carts to check", sub: toCheck ? `${toCheck} to check` : "All clear", count: toCheck, urgent: toCheck > 0 },
    { href: "/staff/picklist", icon: "🧺", title: "Pick list", sub: toPick ? `${toPick} to pick` : "All picked", count: toPick },
    { href: "/staff/tasks", icon: "📦", title: "Tasks", sub: openTasks ? `${openTasks} open` : "Nothing open", count: openTasks },
    { href: "/staff/stock", icon: "🔢", title: "Stock check", sub: "Count and correct a shelf" },
    { href: "/staff/exit", icon: "🚪", title: "Exit check", sub: "Check a shopper's exit code" },
  ];

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <View>
        <Text style={styles.hello}>Hello, {session?.name}</Text>
        {session?.kind === "staff" && (
          <Text style={styles.muted}>
            {roleLabel[session.role]} · {session.staffCode} · store {storeId}
          </Text>
        )}
      </View>
      {tiles.map((t) => (
        <Pressable
          key={t.title}
          accessibilityRole="button"
          onPress={() => router.push(t.href)}
          style={({ pressed }) => [styles.tile, t.urgent && styles.urgent, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.icon}>{t.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{t.title}</Text>
            <Text style={styles.muted}>{t.sub}</Text>
          </View>
          {t.count ? <Text style={[styles.badge, t.urgent && styles.badgeUrgent]}>{t.count}</Text> : null}
        </Pressable>
      ))}
      <Pressable accessibilityRole="button" onPress={() => void signOut()} style={styles.signOut}>
        <Text style={styles.muted}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10 },
  hello: { fontSize: 24, fontWeight: "700", color: colors.text },
  muted: { color: colors.muted },
  tile: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border },
  urgent: { borderColor: "#FB923C", backgroundColor: "#FFF7ED" },
  icon: { fontSize: 26 },
  title: { fontSize: 17, fontWeight: "600", color: colors.text },
  badge: { minWidth: 28, textAlign: "center", backgroundColor: colors.brandSoft, color: colors.brand, fontWeight: "700", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  badgeUrgent: { backgroundColor: "#F97316", color: "#fff" },
  signOut: { alignSelf: "center", padding: 16, marginTop: 16 },
});
