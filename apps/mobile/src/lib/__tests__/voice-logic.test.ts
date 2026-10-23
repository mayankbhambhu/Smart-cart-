import type { SearchResult } from "@smart-cart/contracts";
import { dealPrice, spokenAnswer, voiceErrorText } from "../voice-logic";

const ghee: SearchResult = {
  productId: "p1",
  name: "Amul Pure Ghee 500 ml",
  brand: "Amul",
  category: "Ghee",
  categoryId: null,
  section: "Staples",
  foodType: "veg",
  pricePaise: 30600,
  mrpPaise: 31000,
  unitPricePaise: 61200,
  unit: "L",
  dietTags: [],
  aisle: "B2",
  shelf: "6",
  stock: "in_stock",
  offer: null,
};

describe("reading answers aloud", () => {
  it("says where the top result is and whether it is in stock", () => {
    expect(spokenAnswer([ghee], "en-IN")).toBe("Amul Pure Ghee 500 ml: aisle B2, shelf 6. In stock.");
    expect(spokenAnswer([ghee], "hi-IN")).toBe("Amul Pure Ghee 500 ml: aisle B2, shelf 6 पर है। स्टॉक में है।");
  });

  it("mentions a running offer at its price", () => {
    const deal = { ...ghee, pricePaise: 28900, offer: { id: "o1", title: "Ghee deal", regularPaise: 30600, endsAt: "2026-10-30T00:00:00Z" } };
    expect(spokenAnswer([deal], "en-IN")).toContain("On offer at ₹289.");
  });

  it("never guesses when nothing was found", () => {
    expect(spokenAnswer([], "en-IN")).toMatch(/couldn't find/);
    expect(spokenAnswer([], "hi-IN")).toMatch(/नहीं मिला/);
  });

  it("explains a blocked or missing mic, and stays quiet when the shopper stopped it", () => {
    expect(voiceErrorText("not-allowed")).toMatch(/blocked/);
    expect(voiceErrorText("unavailable")).toMatch(/keyboard/);
    expect(voiceErrorText("aborted")).toBeNull();
  });

  it("prices deals as offer and was", () => {
    expect(dealPrice({ offerPricePaise: 4750, regularPaise: 5200 })).toBe("₹47.50 (was ₹52)");
  });
});
