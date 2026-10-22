import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button";
import { useAuth } from "../lib/auth-store";
import { DEMO, FIREBASE_READY } from "../lib/config";
import { staffLoginMessage } from "../lib/team-logic";
import { colors } from "../lib/theme";

type Side = "shopper" | "store";

/** The first screen: shoppers and the store team sign in differently, and the server decides the side. */
export default function SignInScreen() {
  const [side, setSide] = useState<Side>("shopper");
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.logo}>🛒</Text>
          <Text style={styles.title}>Smart Cart</Text>
          <Text style={styles.subtitle}>Who's signing in?</Text>
          <View style={styles.choice} accessibilityRole="tablist">
            <SideCard on={side === "shopper"} icon="🛍️" title="Shopper" sub="Shop, reserve, pay on your phone" onPress={() => setSide("shopper")} />
            <SideCard on={side === "store"} icon="🏷️" title="Store team" sub="Floor staff and managers" onPress={() => setSide("store")} />
          </View>
          {side === "shopper" ? <ShopperSignIn /> : <StoreTeamSignIn />}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SideCard(props: { on: boolean; icon: string; title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: props.on }}
      onPress={props.onPress}
      style={[styles.sideCard, props.on && styles.sideCardOn]}
    >
      <Text style={styles.sideIcon}>{props.icon}</Text>
      <Text style={[styles.sideTitle, props.on && { color: colors.brand }]}>{props.title}</Text>
      <Text style={styles.sideSub}>{props.sub}</Text>
    </Pressable>
  );
}

function ShopperSignIn() {
  const signIn = useAuth((s) => s.signInShopper);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phoneStep, setPhoneStep] = useState<"off" | "number" | "code">("off");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [testName, setTestName] = useState("");

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  /** Without the Firebase project, real builds can't reach Google, Apple or SMS yet. */
  const needsFirebase = (what: string) =>
    setNotice(`${what} sign-in starts working once the Firebase project is set up. Use test sign-in below for now.`);

  const google = () =>
    DEMO ? run("google", () => signIn("Priya Sharma", "google")) : needsFirebase("Google");
  const apple = () => (DEMO ? run("apple", () => signIn("Apple user", "apple")) : needsFirebase("Apple"));
  const phoneDigits = phone.replace(/\D/g, "");
  const validPhone = /^[6-9]\d{9}$/.test(phoneDigits.slice(-10)) && phoneDigits.length >= 10;

  return (
    <View style={styles.form}>
      <Button title="Continue with Google" variant="secondary" busy={busy === "google"} onPress={google} />
      {(Platform.OS === "ios" || DEMO) && (
        <Button title=" Sign in with Apple" variant="secondary" busy={busy === "apple"} onPress={apple} />
      )}
      {phoneStep === "off" ? (
        <Button
          title="Continue with phone number"
          variant="secondary"
          onPress={() => (DEMO ? setPhoneStep("number") : needsFirebase("Phone"))}
        />
      ) : (
        <View style={styles.panel}>
          <Text style={styles.label}>Mobile number</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="98765 43210"
            keyboardType="phone-pad"
            style={styles.input}
            accessibilityLabel="Mobile number"
            editable={phoneStep === "number"}
          />
          {phoneStep === "number" ? (
            <>
              <TextInput value={name} onChangeText={setName} placeholder="Your name" style={styles.input} accessibilityLabel="Your name" />
              <Button title="Send code" disabled={!validPhone || name.trim().length < 2} onPress={() => setPhoneStep("code")} />
            </>
          ) : (
            <>
              <Text style={styles.hint}>We texted a 6-digit code to +91 {phoneDigits.slice(-10)}.{DEMO ? " Demo code: 123456" : ""}</Text>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="6-digit code"
                keyboardType="number-pad"
                maxLength={6}
                style={styles.input}
                accessibilityLabel="Verification code"
              />
              <Button
                title="Verify and continue"
                busy={busy === "phone"}
                disabled={code.length !== 6}
                onPress={() =>
                  code === "123456"
                    ? void run("phone", () => signIn(name, "phone"))
                    : setNotice("That code doesn't match. Check the SMS and try again.")
                }
              />
            </>
          )}
        </View>
      )}
      {notice && <Text style={styles.notice}>{notice}</Text>}
      {!FIREBASE_READY && !DEMO && (
        <View style={styles.panel}>
          <Text style={styles.label}>Test sign-in</Text>
          <TextInput
            value={testName}
            onChangeText={setTestName}
            placeholder="Your name"
            autoCapitalize="words"
            returnKeyType="done"
            style={styles.input}
            accessibilityLabel="Your name"
          />
          <Button
            title="Continue"
            disabled={testName.trim().length < 2}
            busy={busy === "test"}
            onPress={() => void run("test", () => signIn(testName, "test"))}
          />
        </View>
      )}
      {DEMO && <Text style={styles.note}>Demo: Google, Apple and phone sign-in are simulated. Nothing leaves your browser.</Text>}
    </View>
  );
}

function StoreTeamSignIn() {
  const signIn = useAuth((s) => s.signInStaff);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoLogins, setDemoLogins] = useState<readonly { login: string; password: string; name: string; label: string }[]>([]);

  // Loaded only in the demo build, so real builds don't carry the simulated store.
  useEffect(() => {
    if (DEMO) void import("@smart-cart/demo").then((m) => setDemoLogins(m.DEMO_LOGINS));
  }, []);

  const submit = async () => {
    if (!login.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      // The screen guards take it from here: change-password first if needed, then staff mode.
      await signIn(login, password);
    } catch (e) {
      setError(staffLoginMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.form}>
      <Text style={styles.label}>Staff ID or registered phone</Text>
      <TextInput
        value={login}
        onChangeText={setLogin}
        placeholder="S01-0042 or 98765 43210"
        autoCapitalize="characters"
        autoCorrect={false}
        style={styles.input}
        accessibilityLabel="Staff ID or registered phone"
      />
      <Text style={styles.label}>Password</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        secureTextEntry
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        style={styles.input}
        accessibilityLabel="Password"
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button title="Sign in" busy={busy} disabled={!login.trim() || !password} onPress={() => void submit()} />
      <Text style={styles.note}>
        Store-team accounts are requested by your manager and approved by SmartCart. Your first password comes by SMS
        and you set your own when you first sign in.
      </Text>
      {DEMO && (
        <View style={styles.panel}>
          <Text style={styles.label}>Demo accounts</Text>
          {demoLogins.map((d) => (
            <Pressable
              key={d.login}
              accessibilityRole="button"
              onPress={() => {
                setLogin(d.login);
                setPassword(d.password);
              }}
              style={styles.demoRow}
            >
              <Text style={styles.demoName}>
                {d.label}: {d.name}
              </Text>
              <Text style={styles.demoCreds}>
                {d.login} · {d.password}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { padding: 24, paddingTop: 40, gap: 4, maxWidth: 520, width: "100%", alignSelf: "center" },
  logo: { fontSize: 48, textAlign: "center" },
  title: { fontSize: 28, fontWeight: "700", textAlign: "center", color: colors.text },
  subtitle: { fontSize: 16, textAlign: "center", color: colors.muted, marginTop: 4 },
  choice: { flexDirection: "row", gap: 10, marginTop: 20, marginBottom: 8 },
  sideCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 2,
    borderColor: colors.border,
    gap: 2,
  },
  sideCardOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  sideIcon: { fontSize: 24 },
  sideTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  sideSub: { fontSize: 13, color: colors.muted },
  form: { gap: 10, marginTop: 12 },
  panel: { gap: 8, backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border },
  label: { fontSize: 14, fontWeight: "600", color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 48,
    fontSize: 16,
    backgroundColor: colors.surface,
  },
  hint: { color: colors.muted },
  notice: { color: "#92400E", backgroundColor: "#FEF3C7", borderRadius: 10, padding: 10 },
  error: { color: colors.danger, backgroundColor: colors.dangerSoft, borderRadius: 10, padding: 10 },
  note: { fontSize: 12, color: colors.muted, textAlign: "center", marginTop: 4, lineHeight: 18 },
  demoRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  demoName: { fontWeight: "600", color: colors.text },
  demoCreds: { color: colors.muted, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) },
});
