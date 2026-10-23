import type { DietTag, SearchSource } from "@smart-cart/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { HelpBanner } from "../components/HelpBanner";
import { ProductResult } from "../components/ProductResult";
import { api } from "../lib/api";
import { useAssist } from "../lib/assist-store";
import { speak, stopSpeaking } from "../lib/speak";
import { colors } from "../lib/theme";
import { listen } from "../lib/voice";
import { spokenAnswer, voiceErrorText, type VoiceLang } from "../lib/voice-logic";

const DIETS: { tag: DietTag; label: string }[] = [
  { tag: "veg", label: "Veg" },
  { tag: "jain", label: "Jain" },
  { tag: "no_added_sugar", label: "No added sugar" },
];

const LANGS: { lang: VoiceLang; label: string }[] = [
  { lang: "en-IN", label: "English" },
  { lang: "hi-IN", label: "हिंदी" },
];

const EXAMPLES: Record<VoiceLang, string[]> = {
  "en-IN": ["where is the ghee", "haldi kahan milega", "toor dal"],
  "hi-IN": ["मुझे चीनी चाहिए", "दूध कहाँ है", "हल्दी"],
};

/**
 * US-02 to US-05: find a product's aisle and shelf by typing or speaking (English or Hindi),
 * filter by diet, and compare price per kg. A spoken search's answer is read aloud.
 */
export default function FindScreen() {
  const storeId = useAssist((s) => s.storeId);
  const voiceLang = useAssist((s) => s.voiceLang);
  const readAloud = useAssist((s) => s.readAloud);
  const setVoice = useAssist((s) => s.setVoice);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SearchSource>("search");
  // Starts from the shopper's saved diet preference.
  const [diet, setDiet] = useState<DietTag[]>(() => useAssist.getState().dietPref);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const stopListening = useRef<(() => void) | null>(null);
  // Set when a spoken search (or a tapped example) should have its answer read aloud.
  const answerAloud = useRef(false);

  // Search as the shopper types, after a short pause.
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(
    () => () => {
      stopListening.current?.();
      stopSpeaking();
    },
    [],
  );

  const results = useQuery({
    queryKey: ["search", storeId, query, diet, source],
    queryFn: () => api.search(storeId, query, diet, source),
    enabled: query.length > 0,
  });

  useEffect(() => {
    if (!answerAloud.current || !results.data || results.isFetching) return;
    answerAloud.current = false;
    if (readAloud) speak(spokenAnswer(results.data, voiceLang), voiceLang);
  }, [results.data, results.isFetching, readAloud, voiceLang]);

  const toggle = (tag: DietTag) => setDiet((d) => (d.includes(tag) ? d.filter((x) => x !== tag) : [...d, tag]));

  const run = (q: string, from: SearchSource) => {
    setText(q);
    setQuery(q.trim());
    setSource(from);
    answerAloud.current = true;
  };

  const mic = () => {
    if (listening) return stopListening.current?.();
    stopSpeaking();
    setVoiceNote(null);
    setHeard("");
    setListening(true);
    // Recognisers normally stop at a pause; this stops one that keeps listening to shop noise.
    const limit = setTimeout(() => stopListening.current?.(), 12_000);
    stopListening.current = listen(voiceLang, {
      onPartial: setHeard,
      onFinal: (said) => {
        setHeard("");
        if (said.trim()) run(said, "voice");
      },
      onError: (code) => setVoiceNote(voiceErrorText(code)),
      onEnd: () => {
        clearTimeout(limit);
        setListening(false);
        stopListening.current = null;
      },
    });
  };

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <View style={styles.searchRow}>
          <TextInput
            value={text}
            onChangeText={(t) => {
              setText(t);
              setSource("search");
            }}
            placeholder={voiceLang === "hi-IN" ? "खोजें: हल्दी, दाल, साबुन…" : "Search: haldi, toor dal, shampoo…"}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            style={styles.input}
            accessibilityLabel="Search products"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={listening ? "Stop listening" : "Search by voice"}
            accessibilityState={{ busy: listening }}
            onPress={mic}
            style={({ pressed }) => [styles.mic, listening && styles.micOn, pressed && { opacity: 0.8 }]}
          >
            <Text style={[styles.micIcon, listening && { color: "#fff" }]}>{listening ? "■" : "🎤"}</Text>
          </Pressable>
        </View>
        {(listening || voiceNote) && (
          <Text style={[styles.voiceLine, voiceNote && !listening ? styles.voiceWarn : null]} accessibilityLiveRegion="polite">
            {listening
              ? heard
                ? `“${heard}”`
                : voiceLang === "hi-IN"
                  ? "सुन रहे हैं… बोलिए, जैसे “हल्दी कहाँ है”"
                  : "Listening… say an item, like “where is the ghee”"
              : voiceNote}
          </Text>
        )}
        <View style={styles.chips}>
          {DIETS.map((d) => {
            const on = diet.includes(d.tag);
            return (
              <Pressable
                key={d.tag}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => toggle(d.tag)}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{d.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.voiceRow}>
          <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Voice language">
            {LANGS.map((l) => {
              const on = voiceLang === l.lang;
              return (
                <Pressable
                  key={l.lang}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => void setVoice({ voiceLang: l.lang })}
                  style={[styles.segmentItem, on && styles.segmentOn]}
                >
                  <Text style={[styles.segmentText, on && styles.chipTextOn]}>{l.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: readAloud }}
            onPress={() => {
              if (readAloud) stopSpeaking();
              void setVoice({ readAloud: !readAloud });
            }}
            style={styles.aloud}
          >
            <Text style={styles.aloudText}>{readAloud ? "🔊 Read answers aloud" : "🔇 Answers on screen only"}</Text>
          </Pressable>
        </View>
      </View>

      {query.length === 0 ? (
        <View style={styles.hint}>
          <Text style={styles.muted}>
            Type what you need, or tap 🎤 and say it in English or Hindi. Words like haldi, chawal or doodh work too.
          </Text>
          <Text style={styles.muted}>Results show the aisle and shelf, whether it is in stock, and the price per kg or litre so you can compare brands.</Text>
          <Text style={styles.exampleHead}>Try asking</Text>
          <View style={styles.chips}>
            {EXAMPLES[voiceLang].map((q) => (
              <Pressable key={q} accessibilityRole="button" onPress={() => run(q, "search")} style={styles.chip}>
                <Text style={styles.chipText}>{q}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : results.isPending ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />
      ) : results.isError ? (
        <Text style={[styles.muted, styles.pad]}>Could not search right now. Check your connection.</Text>
      ) : (
        <FlatList
          data={results.data}
          keyExtractor={(r) => r.productId}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => (
            <ProductResult product={item} badge={index === 0 && results.data.length > 1 && item.unitPricePaise ? "BEST VALUE PER " + (item.unit ?? "").toUpperCase() : undefined} />
          )}
          ListEmptyComponent={
            <View style={{ gap: 12 }}>
              <Text style={styles.muted}>
                We couldn't find “{query}” in this store. We have noted it for the store team.
              </Text>
              <HelpBanner />
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  head: { padding: 16, gap: 10, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border },
  searchRow: { flexDirection: "row", gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, backgroundColor: colors.background },
  mic: { width: 50, borderRadius: 12, borderWidth: 1, borderColor: colors.brand, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSoft },
  micOn: { backgroundColor: colors.brand },
  micIcon: { fontSize: 20, color: colors.brand },
  voiceLine: { color: colors.brand, fontWeight: "600" },
  voiceWarn: { color: "#92400E", fontWeight: "400" },
  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.text },
  chipTextOn: { color: "#fff", fontWeight: "600" },
  voiceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  segment: { flexDirection: "row", borderWidth: 1, borderColor: colors.border, borderRadius: 999, overflow: "hidden" },
  segmentItem: { paddingHorizontal: 12, paddingVertical: 5 },
  segmentOn: { backgroundColor: colors.brand },
  segmentText: { color: colors.text, fontSize: 13 },
  aloud: { paddingVertical: 5 },
  aloudText: { color: colors.muted, fontSize: 13 },
  list: { padding: 16, gap: 10 },
  hint: { padding: 16, gap: 8 },
  exampleHead: { marginTop: 8, fontSize: 12, fontWeight: "700", color: colors.muted, letterSpacing: 0.4, textTransform: "uppercase" },
  muted: { color: colors.muted, lineHeight: 20 },
  pad: { padding: 16 },
});
