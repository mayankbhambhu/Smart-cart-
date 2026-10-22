// Generates prisma/data/products.csv: a demo catalogue of about 200 everyday DMart-style items.
//
// Barcodes are SYNTHETIC. They use the GS1 "restricted circulation" prefix 2xx, which is
// reserved for in-store use and never collides with a real manufacturer barcode. Scanning a
// real pack in a shop will not match; to demo with real packs, replace the barcode column
// with codes read off the actual products. GST rates and HSN codes are illustrative and must
// be checked against the current GST schedule before the pilot.
//
// Run once with `pnpm seed:generate-catalog`; the CSV is committed so the seed is stable.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ean13CheckDigit } from "@smart-cart/contracts";

type Family = {
  category: string;
  aisle: string;
  hsn: string;
  gstBp: number;
  brands: string[];
  item: string;
  /** [label, grams, mrp in rupees] */
  packs: [string, number, number][];
};

const families: Family[] = [
  { category: "Dairy", aisle: "A1", hsn: "0401", gstBp: 0, brands: ["Amul", "Mother Dairy", "Nandini"], item: "Toned Milk", packs: [["500 ml", 515, 28], ["1 L", 1030, 56]] },
  { category: "Dairy", aisle: "A1", hsn: "0403", gstBp: 500, brands: ["Amul", "Mother Dairy", "Nestle"], item: "Dahi", packs: [["400 g", 400, 35], ["1 kg", 1000, 80]] },
  { category: "Dairy", aisle: "A1", hsn: "0405", gstBp: 500, brands: ["Amul", "Britannia"], item: "Butter", packs: [["100 g", 100, 58], ["500 g", 500, 285]] },
  { category: "Dairy", aisle: "A1", hsn: "0406", gstBp: 500, brands: ["Amul", "Britannia", "Go"], item: "Cheese Slices", packs: [["200 g", 200, 150]] },
  { category: "Dairy", aisle: "A1", hsn: "0406", gstBp: 0, brands: ["Amul", "Mother Dairy"], item: "Fresh Paneer", packs: [["200 g", 200, 90]] },
  { category: "Staples", aisle: "B1", hsn: "1101", gstBp: 500, brands: ["Aashirvaad", "Pillsbury", "DMart Premia"], item: "Whole Wheat Atta", packs: [["5 kg", 5000, 290], ["10 kg", 10000, 560]] },
  { category: "Staples", aisle: "B1", hsn: "1006", gstBp: 500, brands: ["India Gate", "Daawat", "DMart Premia"], item: "Basmati Rice", packs: [["1 kg", 1000, 160], ["5 kg", 5000, 750]] },
  { category: "Staples", aisle: "B1", hsn: "0713", gstBp: 500, brands: ["Tata Sampann", "DMart Premia"], item: "Toor Dal", packs: [["500 g", 500, 95], ["1 kg", 1000, 180]] },
  { category: "Staples", aisle: "B1", hsn: "0713", gstBp: 500, brands: ["Tata Sampann", "DMart Premia"], item: "Moong Dal", packs: [["500 g", 500, 85], ["1 kg", 1000, 165]] },
  { category: "Staples", aisle: "B2", hsn: "1701", gstBp: 500, brands: ["Madhur", "DMart Premia"], item: "Sugar", packs: [["1 kg", 1000, 55], ["5 kg", 5000, 260]] },
  { category: "Staples", aisle: "B2", hsn: "2501", gstBp: 0, brands: ["Tata", "Aashirvaad"], item: "Iodised Salt", packs: [["1 kg", 1000, 28]] },
  { category: "Staples", aisle: "B2", hsn: "1512", gstBp: 500, brands: ["Fortune", "Saffola", "Gemini"], item: "Sunflower Oil", packs: [["1 L", 910, 165], ["5 L", 4550, 790]] },
  { category: "Staples", aisle: "B2", hsn: "0405", gstBp: 500, brands: ["Amul", "Gowardhan"], item: "Pure Ghee", packs: [["500 ml", 455, 340], ["1 L", 910, 660]] },
  { category: "Spices", aisle: "B3", hsn: "0910", gstBp: 500, brands: ["Everest", "MDH", "Catch"], item: "Turmeric Powder", packs: [["100 g", 100, 38], ["200 g", 200, 72]] },
  { category: "Spices", aisle: "B3", hsn: "0904", gstBp: 500, brands: ["Everest", "MDH", "Catch"], item: "Red Chilli Powder", packs: [["100 g", 100, 45], ["200 g", 200, 86]] },
  { category: "Spices", aisle: "B3", hsn: "0910", gstBp: 500, brands: ["Everest", "MDH"], item: "Garam Masala", packs: [["100 g", 100, 82]] },
  { category: "Beverages", aisle: "C1", hsn: "0902", gstBp: 500, brands: ["Tata Tea", "Red Label", "Wagh Bakri"], item: "Tea", packs: [["250 g", 250, 140], ["500 g", 500, 275]] },
  { category: "Beverages", aisle: "C1", hsn: "2101", gstBp: 500, brands: ["Nescafe", "Bru"], item: "Instant Coffee", packs: [["50 g", 50, 180], ["100 g", 100, 345]] },
  { category: "Beverages", aisle: "C1", hsn: "2202", gstBp: 4000, brands: ["Coca-Cola", "Thums Up", "Sprite"], item: "Soft Drink", packs: [["750 ml", 790, 40], ["2.25 L", 2370, 99]] },
  { category: "Beverages", aisle: "C1", hsn: "2009", gstBp: 500, brands: ["Real", "Tropicana"], item: "Mixed Fruit Juice", packs: [["1 L", 1050, 120]] },
  { category: "Snacks", aisle: "C2", hsn: "1905", gstBp: 500, brands: ["Parle-G", "Britannia Good Day", "Sunfeast"], item: "Biscuits", packs: [["250 g", 250, 30], ["800 g", 800, 90]] },
  { category: "Snacks", aisle: "C2", hsn: "2005", gstBp: 500, brands: ["Lay's", "Bingo", "Uncle Chipps"], item: "Potato Chips", packs: [["52 g", 52, 20], ["115 g", 115, 50]] },
  { category: "Snacks", aisle: "C2", hsn: "2106", gstBp: 500, brands: ["Haldiram's", "Bikaji"], item: "Aloo Bhujia", packs: [["200 g", 200, 55], ["400 g", 400, 105]] },
  { category: "Snacks", aisle: "C2", hsn: "1806", gstBp: 500, brands: ["Cadbury Dairy Milk", "Nestle KitKat", "Amul"], item: "Chocolate", packs: [["50 g", 50, 50], ["150 g", 150, 140]] },
  { category: "Breakfast", aisle: "C3", hsn: "1902", gstBp: 500, brands: ["Maggi", "Yippee", "Top Ramen"], item: "Masala Noodles", packs: [["70 g", 70, 14], ["280 g", 280, 56]] },
  { category: "Breakfast", aisle: "C3", hsn: "1904", gstBp: 500, brands: ["Kellogg's", "Bagrry's"], item: "Corn Flakes", packs: [["475 g", 475, 195]] },
  { category: "Breakfast", aisle: "C3", hsn: "2007", gstBp: 500, brands: ["Kissan", "Maggi"], item: "Tomato Ketchup", packs: [["500 g", 500, 120], ["1 kg", 1000, 175]] },
  { category: "Breakfast", aisle: "C3", hsn: "0409", gstBp: 500, brands: ["Dabur", "Saffola"], item: "Honey", packs: [["250 g", 250, 125], ["500 g", 500, 235]] },
  { category: "Personal care", aisle: "D1", hsn: "3401", gstBp: 500, brands: ["Lux", "Dove", "Santoor", "Lifebuoy"], item: "Bathing Soap", packs: [["100 g x 4", 400, 160]] },
  { category: "Personal care", aisle: "D1", hsn: "3305", gstBp: 500, brands: ["Clinic Plus", "Head & Shoulders", "Dove"], item: "Shampoo", packs: [["180 ml", 190, 160], ["340 ml", 360, 300]] },
  { category: "Personal care", aisle: "D1", hsn: "3306", gstBp: 500, brands: ["Colgate", "Pepsodent", "Close-Up"], item: "Toothpaste", packs: [["150 g", 150, 105]] },
  { category: "Household", aisle: "D2", hsn: "3402", gstBp: 1800, brands: ["Surf Excel", "Tide", "Ariel"], item: "Detergent Powder", packs: [["1 kg", 1000, 140], ["4 kg", 4000, 520]] },
  { category: "Household", aisle: "D2", hsn: "3402", gstBp: 1800, brands: ["Vim", "Pril"], item: "Dishwash Liquid", packs: [["500 ml", 520, 115]] },
  { category: "Household", aisle: "D2", hsn: "3808", gstBp: 1800, brands: ["Lizol", "Harpic"], item: "Floor Cleaner", packs: [["975 ml", 1000, 210]] },
  { category: "Bakery", aisle: "A2", hsn: "1905", gstBp: 0, brands: ["Britannia", "Modern", "Harvest Gold"], item: "Sandwich Bread", packs: [["400 g", 400, 45]] },
  { category: "Bakery", aisle: "A2", hsn: "0407", gstBp: 0, brands: ["Eggoz", "Kegg Farms"], item: "Farm Eggs", packs: [["6 pcs", 360, 60], ["12 pcs", 720, 115]] },
  { category: "Frozen", aisle: "A3", hsn: "2004", gstBp: 500, brands: ["McCain", "Safal"], item: "Frozen French Fries", packs: [["420 g", 420, 125], ["750 g", 750, 205]] },
  { category: "Frozen", aisle: "A3", hsn: "2105", gstBp: 500, brands: ["Amul", "Kwality Wall's", "Havmor"], item: "Vanilla Ice Cream", packs: [["700 ml", 380, 160], ["1 L", 540, 220]] },
  { category: "Staples", aisle: "B1", hsn: "1006", gstBp: 500, brands: ["Fortune", "DMart Premia"], item: "Sona Masoori Rice", packs: [["5 kg", 5000, 420], ["10 kg", 10000, 820]] },
  { category: "Staples", aisle: "B1", hsn: "1904", gstBp: 500, brands: ["Tata Sampann", "DMart Premia"], item: "Poha", packs: [["500 g", 500, 45], ["1 kg", 1000, 85]] },
  { category: "Staples", aisle: "B1", hsn: "1103", gstBp: 500, brands: ["Aashirvaad", "DMart Premia"], item: "Sooji Rava", packs: [["500 g", 500, 40], ["1 kg", 1000, 75]] },
  { category: "Staples", aisle: "B1", hsn: "1106", gstBp: 500, brands: ["Rajdhani", "Tata Sampann"], item: "Besan", packs: [["500 g", 500, 70], ["1 kg", 1000, 135]] },
  { category: "Staples", aisle: "B2", hsn: "1514", gstBp: 500, brands: ["Fortune", "Dhara", "Patanjali"], item: "Kachi Ghani Mustard Oil", packs: [["1 L", 910, 185]] },
  { category: "Breakfast", aisle: "C3", hsn: "2001", gstBp: 500, brands: ["Mother's Recipe", "Priya"], item: "Mango Pickle", packs: [["300 g", 300, 110]] },
  { category: "Beverages", aisle: "C1", hsn: "2201", gstBp: 500, brands: ["Bisleri", "Kinley"], item: "Packaged Drinking Water", packs: [["1 L", 1000, 20], ["5 L", 5000, 75]] },
  { category: "Personal care", aisle: "D1", hsn: "3305", gstBp: 500, brands: ["Parachute", "Dabur Amla"], item: "Hair Oil", packs: [["200 ml", 190, 110], ["500 ml", 470, 250]] },
  { category: "Personal care", aisle: "D1", hsn: "3401", gstBp: 500, brands: ["Dettol", "Lifebuoy", "Savlon"], item: "Handwash", packs: [["200 ml", 210, 99], ["750 ml refill", 780, 199]] },
  { category: "Personal care", aisle: "D1", hsn: "9619", gstBp: 500, brands: ["Whisper", "Stayfree"], item: "Sanitary Pads XL", packs: [["15 pads", 300, 199], ["30 pads", 600, 380]] },
  { category: "Baby care", aisle: "D3", hsn: "9619", gstBp: 500, brands: ["Pampers", "Huggies", "MamyPoko"], item: "Pant Diapers M", packs: [["56 pcs", 1900, 899]] },
  { category: "Household", aisle: "D2", hsn: "4818", gstBp: 500, brands: ["Origami", "Premier"], item: "Toilet Tissue Roll", packs: [["4 rolls", 480, 160]] },
  { category: "Household", aisle: "D2", hsn: "3923", gstBp: 1800, brands: ["Ezee", "Presto"], item: "Garbage Bags Medium", packs: [["30 bags", 300, 99]] },
];

const header = [
  "barcode", "name", "brand", "category", "hsn_code", "gst_rate_bp", "weight_g",
  "mrp_paise", "price_paise", "aisle", "shelf", "on_hand", "low_stock_threshold",
];

const rows: string[][] = [];
let serial = 0;
for (const f of families) {
  for (const brand of f.brands) {
    for (const [label, grams, mrp] of f.packs) {
      serial += 1;
      // 2 + 0 (store-internal prefix "20") + 10-digit serial = 12 digits, then the check digit.
      const first12 = `20${String(serial).padStart(10, "0")}`;
      const barcode = `${first12}${ean13CheckDigit(first12)}`;
      const mrpPaise = mrp * 100;
      // DMart-style everyday discount of 0 to 15 percent, deterministic per item.
      const discountPct = (serial * 7) % 16;
      const pricePaise = Math.round((mrpPaise * (100 - discountPct)) / 100 / 100) * 100;
      const shelf = String(((serial - 1) % 6) + 1);
      // Every 15th item starts below its threshold so the dashboard has low-stock rows to show.
      const onHand = serial % 15 === 0 ? 3 + (serial % 6) : 20 + ((serial * 13) % 80);
      rows.push([
        barcode, `${brand} ${f.item} ${label}`, brand, f.category, f.hsn, String(f.gstBp),
        String(grams), String(mrpPaise), String(pricePaise), f.aisle, shelf, String(onHand), "10",
      ]);
    }
  }
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
const out = join(dirname(fileURLToPath(import.meta.url)), "data/products.csv");
writeFileSync(out, csv);
console.log(`Wrote ${rows.length} products to ${out}`);
