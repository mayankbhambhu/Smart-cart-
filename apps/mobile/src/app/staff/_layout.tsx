import { Stack } from "expo-router";
import { colors } from "../../lib/theme";

// Staff mode opens on its home screen whichever way the guard sends someone here.
export const unstable_settings = { initialRouteName: "index" };

/** Staff mode on the handheld: only reachable when the signed-in account is on the store team. */
export default function StaffLayout() {
  return (
    <Stack screenOptions={{ headerTintColor: colors.brand, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" options={{ title: "Staff mode" }} />
      <Stack.Screen name="help" options={{ title: "Help requests" }} />
      <Stack.Screen name="security" options={{ title: "Carts to check" }} />
      <Stack.Screen name="picklist" options={{ title: "Pick list" }} />
      <Stack.Screen name="tasks" options={{ title: "Tasks" }} />
      <Stack.Screen name="stock" options={{ title: "Stock check" }} />
      <Stack.Screen name="exit" options={{ title: "Exit check" }} />
    </Stack>
  );
}
