import { useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ApiError } from "../lib/api";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HelpBanner } from "../components/HelpBanner";
import { whereLabel } from "../lib/assist-logic";
import { useAssist, type ChatMessage } from "../lib/assist-store";
import { formatInr } from "../lib/money";
import { colors } from "../lib/theme";

const STARTERS = ["Where is the haldi?", "Cheapest toor dal per kg?", "Jain snacks?", "Paneer kahan milega?"];

/** Ask SmartCart: answers only from the store's catalogue and stock, never guesses. */
export default function AskScreen() {
  const { chat, ask } = useAssist();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const list = useRef<FlatList<ChatMessage>>(null);
  const insets = useSafeAreaInsets();

  const send = async (message: string) => {
    const m = message.trim();
    if (!m || busy) return;
    setText("");
    setBusy(true);
    setFailed(null);
    try {
      await ask(m);
    } catch (e) {
      setFailed(
        e instanceof ApiError && e.code === "rate_limited"
          ? "That's a lot of questions at once. Wait a few seconds and ask again."
          : "Couldn't reach the store. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <FlatList
        ref={list}
        data={chat}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        ListHeaderComponent={
          <View style={styles.intro}>
            <Text style={styles.introTitle}>Ask SmartCart</Text>
            <Text style={styles.muted}>
              I answer from this store's live catalogue and stock. If I'm not sure, I'll say so and you can call a staff member.
            </Text>
            {chat.length === 0 && (
              <View style={styles.starters}>
                {STARTERS.map((s) => (
                  <Pressable key={s} accessibilityRole="button" onPress={() => void send(s)} style={styles.starter}>
                    <Text style={styles.starterText}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => <Bubble message={item} />}
        ListFooterComponent={
          <View style={{ gap: 8 }}>
            {busy && <Text style={styles.muted}>Checking the store…</Text>}
            {failed && <Text style={{ color: colors.danger }}>{failed}</Text>}
          </View>
        }
      />
      <View style={[styles.composer, { paddingBottom: 10 + insets.bottom }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Where is…, cheapest…, do you have…"
          style={styles.input}
          onSubmitEditing={() => void send(text)}
          returnKeyType="send"
          accessibilityLabel="Your question"
        />
        <Pressable accessibilityRole="button" onPress={() => void send(text)} disabled={busy || !text.trim()} style={[styles.send, (busy || !text.trim()) && { opacity: 0.5 }]}>
          <Text style={styles.sendText}>Ask</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <View style={[styles.bubble, styles.mine]}>
        <Text style={styles.mineText}>{message.content}</Text>
      </View>
    );
  }
  const unsure = message.products?.length === 0;
  return (
    <View style={{ gap: 6 }}>
      <View style={[styles.bubble, styles.theirs]}>
        <Text style={styles.theirText}>{message.content}</Text>
        <Text style={styles.source}>{message.mode === "ai" ? "AI answer from store data" : "From store data"}</Text>
      </View>
      {message.products?.slice(0, 3).map((p) => (
        <View key={p.productId} style={styles.fact}>
          <Text style={styles.factName}>{p.name}</Text>
          <Text style={styles.factMeta}>
            {whereLabel(p)} · {formatInr(p.pricePaise)}
          </Text>
        </View>
      ))}
      {unsure && <HelpBanner compact />}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  intro: { gap: 8, marginBottom: 8 },
  introTitle: { fontSize: 20, fontWeight: "700", color: colors.text },
  muted: { color: colors.muted, lineHeight: 20 },
  starters: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  starter: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  starterText: { color: colors.text },
  bubble: { maxWidth: "85%", borderRadius: 16, padding: 12 },
  mine: { alignSelf: "flex-end", backgroundColor: colors.brand },
  mineText: { color: "#fff", fontSize: 15 },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  theirText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  source: { fontSize: 11, color: colors.muted, marginTop: 6 },
  fact: { alignSelf: "flex-start", marginLeft: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.brandSoft, borderRadius: 10 },
  factName: { fontWeight: "600", color: colors.text },
  factMeta: { color: colors.brand, fontSize: 13 },
  composer: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 },
  send: { backgroundColor: colors.brand, borderRadius: 999, paddingHorizontal: 18, justifyContent: "center" },
  sendText: { color: "#fff", fontWeight: "600" },
});
