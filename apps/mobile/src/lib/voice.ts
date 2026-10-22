/**
 * Voice search on phones (US-02), with on-device speech recognition from expo-speech-recognition.
 * It needs a development or store build: in Expo Go the native module is missing, so voice reports
 * "unavailable" and the shopper can use the keyboard's own mic instead.
 */
import type { ExpoSpeechRecognitionModule as Module } from "expo-speech-recognition";
import type { VoiceHandlers, VoiceLang } from "./voice-logic";

let speech: typeof Module | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  speech = (require("expo-speech-recognition") as { ExpoSpeechRecognitionModule: typeof Module }).ExpoSpeechRecognitionModule;
} catch {
  speech = null;
}

export function voiceAvailable(): boolean {
  try {
    return speech !== null && speech.isRecognitionAvailable();
  } catch {
    return false;
  }
}

/** Starts listening; returns a function that stops early. */
export function listen(lang: VoiceLang, h: VoiceHandlers): () => void {
  const mod = speech;
  if (!mod || !voiceAvailable()) {
    h.onError("unavailable");
    h.onEnd();
    return () => {};
  }
  const subs = [
    mod.addListener("result", (e) => {
      const text = e.results[0]?.transcript ?? "";
      if (e.isFinal) h.onFinal(text);
      else h.onPartial(text);
    }),
    mod.addListener("error", (e) => h.onError(e.error)),
    mod.addListener("end", () => {
      subs.forEach((s) => s.remove());
      h.onEnd();
    }),
  ];
  void mod.requestPermissionsAsync().then((p) => {
    if (!p.granted) {
      subs.forEach((s) => s.remove());
      h.onError("not-allowed");
      h.onEnd();
      return;
    }
    mod.start({ lang, interimResults: true, continuous: false, maxAlternatives: 1 });
  });
  return () => mod.stop();
}
