import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAuth } from "../lib/auth-store";
import { DEMO } from "../lib/config";
import { colors } from "../lib/theme";

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());
  const ready = useAuth((s) => s.ready);
  const signedIn = useAuth((s) => s.session !== null);

  useEffect(() => {
    void useAuth.getState().restore();
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        {DEMO && (
          <View style={{ backgroundColor: "#FEF3C7", paddingVertical: 6, paddingHorizontal: 12 }}>
            <Text style={{ color: "#78350F", fontSize: 12, textAlign: "center" }}>
              Demo: a simulated store in your browser. No real payments. Open the dashboard demo alongside to play staff.
            </Text>
          </View>
        )}
        <Stack screenOptions={{ headerTintColor: colors.brand, contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="index" options={{ title: "Smart Cart" }} />
            <Stack.Screen name="pair" options={{ title: "Pair a cart" }} />
            <Stack.Screen name="cart/index" options={{ title: "Your cart" }} />
            <Stack.Screen name="cart/scan" options={{ title: "Scan items", presentation: "modal" }} />
            <Stack.Screen name="cart/checkout" options={{ title: "Checkout" }} />
            <Stack.Screen name="receipt/[orderId]" options={{ title: "Receipt" }} />
            <Stack.Screen name="find" options={{ title: "Find a product" }} />
            <Stack.Screen name="list" options={{ title: "Smart list" }} />
            <Stack.Screen name="ask" options={{ title: "Ask SmartCart" }} />
            <Stack.Screen name="help" options={{ title: "Call for help", presentation: "modal" }} />
          </Stack.Protected>
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
