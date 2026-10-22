/**
 * Demo builds' copy of the API's "find it fast" rules (apps/api/src/smartcart/assist_service.py),
 * so search, smart list and Ask SmartCart behave the same on GitHub Pages without a server.
 */
import type { RouteListResponse, SearchResult, StockStatus } from "@smart-cart/contracts";
import type { DemoProduct } from "./types.js";

type FindProduct = Pick<
  DemoProduct,
  "productId" | "name" | "brand" | "category" | "pricePaise" | "mrpPaise" | "dietTags" | "aisle" | "shelf" | "lowStockThreshold"
>;

const SYNONYMS: Record<string, string> = {
  doodh: "milk", curd: "dahi", chawal: "rice", haldi: "turmeric", mirchi: "chilli", chilly: "chilli",
  cheeni: "sugar", shakkar: "sugar", namak: "salt", tel: "oil", chai: "tea", anda: "eggs", makhan: "butter",
  wheat: "atta", flour: "atta", rava: "sooji", suji: "sooji", semolina: "sooji", gram: "besan", nappies: "diapers",
};
const NOISE = /^(\d+(\.\d+)?|x\d*|\d+x|kg|g|gm|gms|l|ltr|litre|liter|ml|pcs?|packs?|of|and|the|a)$/;
const STOPWORDS = new Set(
  ("where what which who how much many is are the a an do does you have has can could i me my find get buy want " +
    "need for in on of to any some there this that store shop please show cheapest cheaper best price cost stock " +
    "available kya hai kahan milega with without and or it its be am should would like tell about").split(" "),
);

export function queryWords(text: string): string[] {
  const words: string[] = [];
  for (const raw of text.toLowerCase().split(/[\s,]+/)) {
    let w = raw.replace(/^[?!.,;:()\-'"]+|[?!.,;:()\-'"]+$/g, "");
    if (!w || NOISE.test(w)) continue;
    w = SYNONYMS[w] ?? w;
    if (w.length > 4 && w.endsWith("s")) w = w.slice(0, -1);
    words.push(w);
  }
  return words.slice(0, 6);
}

export function packSize(name: string): [number, "kg" | "L" | "pc"] | null {
  const m = /(\d+(?:\.\d+)?)\s*(kg|g|l|ml|pcs|pads|rolls|bags)\b(?:\s*x\s*(\d+))?/i.exec(name);
  if (!m) return null;
  const qty = Number(m[1]) * Number(m[3] ?? 1);
  const unit = m[2]!.toLowerCase();
  if (unit === "g") return [qty / 1000, "kg"];
  if (unit === "ml") return [qty / 1000, "L"];
  if (unit === "kg") return [qty, "kg"];
  if (unit === "l") return [qty, "L"];
  return [qty, "pc"];
}

export function stockStatus(available: number, threshold: number): StockStatus {
  if (available <= 0) return "out";
  return available <= threshold ? "low" : "in_stock";
}

function aisleKey(r: SearchResult): [string, number, number] {
  if (!r.aisle) return ["~", 0, 0];
  const m = /([A-Za-z]+)(\d*)/.exec(r.aisle);
  return [m ? m[1]!.toUpperCase() : r.aisle, m ? Number(m[2] || 0) : 0, Number(r.shelf) || 0];
}
const cmpKey = (a: [string, number, number], b: [string, number, number]) =>
  a[0].localeCompare(b[0]) || a[1] - b[1] || a[2] - b[2];

export function search(
  products: FindProduct[],
  available: (productId: string) => number,
  q: string,
  diet: string[] = [],
): SearchResult[] {
  const words = queryWords(q);
  if (words.length === 0) return [];
  return products
    .filter((p) => words.every((w) => [p.name, p.brand ?? "", p.category].some((f) => f.toLowerCase().includes(w))))
    .filter((p) => diet.every((d) => p.dietTags.includes(d)))
    .map((p): SearchResult => {
      const size = packSize(p.name);
      return {
        productId: p.productId,
        name: p.name,
        brand: p.brand,
        category: p.category,
        pricePaise: p.pricePaise,
        mrpPaise: p.mrpPaise,
        unitPricePaise: size ? Math.round(p.pricePaise / size[0]) : null,
        unit: size ? size[1] : null,
        dietTags: p.dietTags,
        aisle: p.aisle,
        shelf: p.shelf,
        stock: stockStatus(available(p.productId), p.lowStockThreshold),
      };
    })
    .sort(
      (a, b) =>
        Number(a.unitPricePaise === null) - Number(b.unitPricePaise === null) ||
        (a.unitPricePaise ?? 0) - (b.unitPricePaise ?? 0) ||
        a.name.localeCompare(b.name),
    );
}

const STOCK_RANK: Record<StockStatus, number> = { in_stock: 0, low: 1, unknown: 2, out: 3 };

export function routeList(find: (q: string) => SearchResult[], lines: string[]): RouteListResponse {
  const cleaned = lines.map((l) => l.trim()).filter(Boolean).slice(0, 60);
  const picked: RouteListResponse["stops"][number]["items"] = [];
  const notFound: string[] = [];
  for (const line of cleaned) {
    const matches = queryWords(line).length ? find(line) : [];
    if (matches.length === 0) {
      notFound.push(line);
      continue;
    }
    const wanted = packSize(line)?.join(" ");
    const offSize = (r: SearchResult) => (wanted !== undefined && packSize(r.name)?.join(" ") !== wanted ? 1 : 0);
    const best = [...matches].sort(
      (a, b) =>
        STOCK_RANK[a.stock] - STOCK_RANK[b.stock] ||
        offSize(a) - offSize(b) ||
        (a.unitPricePaise ?? 1e12) - (b.unitPricePaise ?? 1e12),
    )[0]!;
    picked.push({ line, product: best, alternatives: matches.length - 1 });
  }
  picked.sort((a, b) => cmpKey(aisleKey(a.product), aisleKey(b.product)));
  const stops: RouteListResponse["stops"] = [];
  for (const p of picked) {
    const aisle = p.product.aisle ?? "?";
    if (stops.at(-1)?.aisle !== aisle) stops.push({ aisle, category: p.product.category, items: [] });
    stops.at(-1)!.items.push(p);
  }
  return { stops, notFound, matched: picked.length, total: cleaned.length };
}

/** Products relevant to a question: each content word searched, ranked by words matched. */
export function retrieve(find: (q: string) => SearchResult[], message: string): SearchResult[] {
  const words = queryWords(message).filter((w) => !STOPWORDS.has(w) && w.length > 1).slice(0, 5);
  const scored = new Map<string, { n: number; p: SearchResult }>();
  for (const w of words)
    for (const p of find(w).slice(0, 10)) scored.set(p.productId, { n: (scored.get(p.productId)?.n ?? 0) + 1, p });
  const ranked = [...scored.values()].sort((a, b) => b.n - a.n || (a.p.unitPricePaise ?? 1e12) - (b.p.unitPricePaise ?? 1e12));
  const best = ranked[0]?.n ?? 0;
  return ranked.filter((r) => r.n === best).map((r) => r.p).slice(0, 12);
}

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

/** The no-AI answer, the same as the API gives without an API key. */
export function rulesAnswer(products: SearchResult[]): string {
  if (products.length === 0)
    return "I couldn't find that in this store's catalogue, so I won't guess. Tap Call for help and a staff member will come to you.";
  const stock = { in_stock: "in stock", low: "running low", out: "out of stock", unknown: "stock not confirmed" };
  return products
    .slice(0, 3)
    .map((p) => `${p.name}: ${p.aisle ? `aisle ${p.aisle}, shelf ${p.shelf}` : "location not mapped"}, ${rupees(p.pricePaise)}, ${stock[p.stock]}.`)
    .join(" ");
}
