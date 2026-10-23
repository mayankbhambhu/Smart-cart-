import * as Speech from "expo-speech";
import type { VoiceLang } from "./voice-logic";

/** Reads an answer aloud in the shopper's language, cutting off anything still being read. */
export function speak(text: string, lang: VoiceLang) {
  void Speech.stop();
  Speech.speak(text, { language: lang, rate: 0.95 });
}

export function stopSpeaking() {
  void Speech.stop();
}
