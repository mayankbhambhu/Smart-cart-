import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "../components/Button";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth-store";
import { passwordMessage, passwordProblem } from "../lib/team-logic";
import { colors } from "../lib/theme";

/** First sign-in with the temporary password from the SMS: staff set their own before anything else. */
export default function ChangePasswordScreen() {
  const session = useAuth((s) => s.session);
  const changePassword = useAuth((s) => s.changePassword);
  const signOut = useAuth((s) => s.signOut);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const problem = passwordProblem(next);
    if (problem) return setError(passwordMessage(problem));
    if (next !== again) return setError("The two new passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
    } catch (e) {
      setError(passwordMessage(e instanceof ApiError ? e.code : ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.body}>
      <Text style={styles.title}>Welcome, {session?.name}</Text>
      <Text style={styles.muted}>
        Set your own password to finish signing in. Don't share it: everything you do in staff mode is recorded under
        your staff ID{session?.kind === "staff" && session.staffCode ? ` (${session.staffCode})` : ""}.
      </Text>
      <TextInput value={current} onChangeText={setCurrent} placeholder="Temporary password from the SMS" secureTextEntry style={styles.input} accessibilityLabel="Temporary password" />
      <TextInput value={next} onChangeText={setNext} placeholder="New password (8+ characters)" secureTextEntry style={styles.input} accessibilityLabel="New password" />
      <TextInput value={again} onChangeText={setAgain} placeholder="New password again" secureTextEntry style={styles.input} accessibilityLabel="New password again" onSubmitEditing={() => void submit()} />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button title="Save and continue" busy={busy} disabled={!current || !next || !again} onPress={() => void submit()} />
      <Button title="Sign out" variant="secondary" onPress={() => void signOut()} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 12, maxWidth: 520, width: "100%", alignSelf: "center" },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  muted: { color: colors.muted, lineHeight: 20 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, minHeight: 48, fontSize: 16, backgroundColor: colors.surface },
  error: { color: colors.danger, backgroundColor: colors.dangerSoft, borderRadius: 10, padding: 10 },
});
