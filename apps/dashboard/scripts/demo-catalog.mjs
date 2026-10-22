// Builds src/lib/demo/catalog.json from the API's seed CSV, so the demo build shows the same
// store as a freshly seeded API. Run by `pnpm build:demo`.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const csv = readFileSync(join(here, "../../api/src/smartcart/data/products.csv"), "utf8").trim().split("\n");
const header = csv[0].split(",");
const products = csv.slice(1).map((line, i) => {
  const r = Object.fromEntries(line.split(",").map((v, j) => [header[j], v]));
  return {
    productId: `demo-${i + 1}`,
    barcode: r.barcode,
    name: r.name,
    brand: r.brand || null,
    category: r.category,
    gstRateBp: Number(r.gst_rate_bp),
    pricePaise: Number(r.price_paise),
    onHand: Number(r.on_hand),
    lowStockThreshold: Number(r.low_stock_threshold),
    aisle: r.aisle || null,
    shelf: r.shelf || null,
  };
});
writeFileSync(join(here, "../src/lib/demo/catalog.json"), JSON.stringify(products) + "\n");
console.log(`Wrote ${products.length} demo products`);
