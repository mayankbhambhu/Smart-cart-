import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button";
import { useAuth } from "../lib/auth-store";
import { colors } from "../lib/theme";

export default function SignInScreen() {
  const signIn = useAuth((s) => s.signIn);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = name.trim().length >= 2;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await signIn(name);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.body}>
        <Text style={styles.logo}>🛒</Text>
        <Text style={styles.title}>Smart Cart</Text>
        <Text style={styles.subtitle}>Scan as you shop, pay on your phone, walk out.</Text>
        <View style={styles.form}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            accessibilityLabel="Your name"
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={submit}
            style={styles.input}
          />
          <Button title="Continue" onPress={submit} disabled={!valid} busy={busy} />
        </View>
        <Text style={styles.note}>Test sign-in. Google, Apple, email and phone sign-in arrive with Firebase.</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, justifyContent: "center", padding: 24 },
  logo: { fontSize: 56, textAlign: "center" },
  title: { fontSize: 28, fontWeight: "700", textAlign: "center", color: colors.text, marginTop: 8 },
  subtitle: { fontSize: 16, textAlign: "center", color: colors.muted, marginTop: 8 },
  form: { gap: 12, marginTop: 40 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 48,
    fontSize: 16,
    backgroundColor: colors.surface,
  },
  note: { fontSize: 12, color: colors.muted, textAlign: "center", marginTop: 16 },
});
