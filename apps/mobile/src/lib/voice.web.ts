/**
 * Voice search in the browser (the web demo, and phones opening it): the Web Speech API, which
 * Chrome on Android and Safari on iPhone both have. Embedded previews may block the microphone;
 * then voice reports "not-allowed" and typing still works.
 */
import type { VoiceHandlers, VoiceLang } from "./voice-logic";

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const Ctor: (new () => Recognition) | undefined =
  typeof window === "undefined"
    ? undefined
    : ((window as unknown as Record<string, unknown>).SpeechRecognition ??
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as (new () => Recognition) | undefined;

export function voiceAvailable(): boolean {
  return Ctor !== undefined;
}

export function listen(lang: VoiceLang, h: VoiceHandlers): () => void {
  if (!Ctor) {
    h.onError("unavailable");
    h.onEnd();
    return () => {};
  }
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    let text = "";
    let final = false;
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i]![0]!.transcript;
      final = e.results[i]!.isFinal;
    }
    if (final) h.onFinal(text);
    else h.onPartial(text);
  };
  rec.onerror = (e) => h.onError(e.error);
  rec.onend = () => h.onEnd();
  try {
    rec.start();
  } catch {
    h.onError("not-allowed");
    h.onEnd();
  }
  return () => rec.stop();
}
