import { describe, expect, it } from "vitest";
import { catalog } from "./catalog.js";
import { Deals } from "./deals.js";
import { DemoApiError } from "./errors.js";
import { queryWords } from "./find.js";
import { ShopperDemo } from "./shopper.js";

const token = "dev:u1:Priya";
const parleG = catalog.find((p) => p.name === "Parle-G Biscuits 250 g")!;
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

describe("voice search words", () => {
  it("keeps only the item from a spoken question, in Hindi or English", () => {
    expect(queryWords("haldi kahan milega?")).toEqual(["turmeric"]);
    expect(queryWords("मुझे चीनी चाहिए")).toEqual(["sugar"]);
    expect(queryWords("दूध कहाँ है।")).toEqual(["milk"]);
    expect(queryWords("Where is the toor dal")).toEqual(["toor", "dal"]);
  });

  it("puts the named product first, not the rest of its category", async () => {
    const found = (await new ShopperDemo().request("GET", "/v1/stores/S-01/products/search?q=where%20is%20the%20ghee", undefined, null)) as {
      results: { name: string }[];
    };
    expect(found.results[0]!.name).toContain("Ghee");
  });
});

describe("aisle deals in the demo", () => {
  it("opens with the seed's offers in walking order, filtered by aisle and diet", async () => {
    const api = new ShopperDemo();
    const all = (await api.request("GET", "/v1/stores/S-01/offers", undefined, null)) as { offers: { aisle: string }[] };
    expect(all.offers.length).toBe(8);
    const a2 = (await api.request("GET", "/v1/stores/S-01/offers?aisle=a2", undefined, null)) as {
      offers: { aisle: string; foodType: string }[];
    };
    expect(a2.offers.every((o) => o.aisle === "A2")).toBe(true);
    expect(a2.offers.some((o) => o.foodType === "egg")).toBe(true);
    const veg = (await api.request("GET", "/v1/stores/S-01/offers?aisle=A2&diet=veg", undefined, null)) as {
      offers: { foodType: string }[];
    };
    expect(veg.offers.length).toBeGreaterThan(0);
    expect(veg.offers.every((o) => o.foodType === "veg")).toBe(true);
  });

  it("prices search and the cart at the offer until a manager ends it", async () => {
    const api = new ShopperDemo();
    const offer = api.deals.create({ productId: parleG.productId, title: "Biscuit deal", offerPricePaise: 2500, endsAt: inDays(3) });
    const found = (await api.request("GET", "/v1/stores/S-01/products/search?q=parle-g%20250", undefined, null)) as {
      results: { productId: string; pricePaise: number; offer: { regularPaise: number } | null }[];
    };
    const hit = found.results.find((r) => r.productId === parleG.productId)!;
    expect(hit.pricePaise).toBe(2500);
    expect(hit.offer?.regularPaise).toBe(parleG.pricePaise);

    const cart = (await api.request("POST", "/v1/carts/pair", { cartCode: "C-0007" }, token)) as { sessionId: string };
    const snap = (await api.request("POST", `/v1/carts/${cart.sessionId}/items`, { barcode: parleG.barcode, qty: 2, requestId: "r" }, token)) as {
      totals: { totalPaise: number };
    };
    expect(snap.totals.totalPaise).toBe(5000);

    api.deals.end(offer.id);
    const after = (await api.request("GET", `/v1/carts/${cart.sessionId}`, undefined, token)) as { totals: { totalPaise: number } };
    expect(after.totals.totalPaise).toBe(parleG.pricePaise * 2);
  });

  it("refuses offers that don't lower the price, run too long or overlap", () => {
    const deals = new Deals();
    const body = { productId: parleG.productId, title: "Deal", endsAt: inDays(2) };
    const code = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as DemoApiError).code;
      }
      return null;
    };
    expect(code(() => deals.create({ ...body, offerPricePaise: parleG.pricePaise }))).toBe("offer_price_not_lower");
    expect(code(() => deals.create({ ...body, offerPricePaise: 2000, endsAt: inDays(40) }))).toBe("invalid_offer_window");
    deals.create({ ...body, offerPricePaise: 2000 });
    expect(code(() => deals.create({ ...body, offerPricePaise: 1900 }))).toBe("offer_exists");
  });
});
