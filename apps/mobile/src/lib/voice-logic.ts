import type { Offer, SearchResult } from "@smart-cart/contracts";

/** The languages the mic listens in: Indian English, and Hindi (heard in Devanagari). */
export type VoiceLang = "en-IN" | "hi-IN";

export type VoiceHandlers = {
  /** Words heard so far, while the shopper is still speaking. */
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  /** not-allowed, no-speech, network, language-not-supported, unavailable, ... */
  onError: (code: string) => void;
  /** Always called last, however listening stopped. */
  onEnd: () => void;
};

const say = (paise: number) => `₹${paise % 100 ? (paise / 100).toFixed(2) : paise / 100}`;

const stockEn: Record<SearchResult["stock"], string> = {
  in_stock: "In stock.",
  low: "Only a few left.",
  out: "Out of stock right now.",
  unknown: "Stock not confirmed.",
};
const stockHi: Record<SearchResult["stock"], string> = {
  in_stock: "स्टॉक में है।",
  low: "थोड़ा ही बचा है।",
  out: "अभी स्टॉक में नहीं है।",
  unknown: "स्टॉक पक्का नहीं है।",
};

/**
 * What the app reads aloud after a spoken search: the top result's aisle, shelf, stock and any
 * offer, all from the search results. Nothing found means saying so and pointing to floor help,
 * never a guess (the deck's guardrail).
 */
export function spokenAnswer(results: SearchResult[], lang: VoiceLang): string {
  const top = results[0];
  if (!top) {
    return lang === "hi-IN"
      ? "यह इस स्टोर में नहीं मिला। मदद चाहिए तो Call for help दबाएँ।"
      : "I couldn't find that in this store. Tap Call for help and someone will come to you.";
  }
  const where = top.aisle ? `aisle ${top.aisle}${top.shelf ? `, shelf ${top.shelf}` : ""}` : null;
  if (lang === "hi-IN") {
    const parts = [where ? `${top.name}: ${where} पर है।` : `${top.name}: इसकी जगह अभी तय नहीं है।`, stockHi[top.stock]];
    if (top.offer) parts.push(`ऑफ़र पर ${say(top.pricePaise)} में।`);
    return parts.join(" ");
  }
  const parts = [`${top.name}: ${where ?? "location not mapped"}.`, stockEn[top.stock]];
  if (top.offer) parts.push(`On offer at ${say(top.pricePaise)}.`);
  return parts.join(" ");
}

/** What to tell the shopper when the mic can't be used. */
export function voiceErrorText(code: string): string | null {
  switch (code) {
    case "aborted":
      return null;
    case "no-speech":
    case "nomatch":
      return "Didn't catch that. Tap the mic and say the item again.";
    case "not-allowed":
    case "service-not-allowed":
      return "The microphone is blocked. Allow it for Smart Cart in settings, or type instead.";
    case "language-not-supported":
      return "This phone can't recognise that language. Switch language or type instead.";
    case "network":
      return "Voice search needs an internet connection.";
    case "unavailable":
      return "Voice search isn't available on this phone yet. Tap the mic on your keyboard, or type.";
    default:
      return "Voice search didn't work. Type instead.";
  }
}

/** "₹47 (was ₹52)", for deal alerts. */
export function dealPrice(o: Pick<Offer, "offerPricePaise" | "regularPaise">): string {
  return `${say(o.offerPricePaise)} (was ${say(o.regularPaise)})`;
}
