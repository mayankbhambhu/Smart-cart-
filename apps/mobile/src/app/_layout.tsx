import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAuth } from "../lib/auth-store";
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
        <Stack screenOptions={{ headerTintColor: colors.brand, contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="index" options={{ title: "Smart Cart" }} />
            <Stack.Screen name="pair" options={{ title: "Pair a cart" }} />
            <Stack.Screen name="cart/index" options={{ title: "Your cart" }} />
            <Stack.Screen name="cart/scan" options={{ title: "Scan items", presentation: "modal" }} />
          </Stack.Protected>
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
