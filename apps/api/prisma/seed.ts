// Seeds one demo store, its carts, and the product catalogue from prisma/data/products.csv.
// Safe to run more than once: everything is upserted by its natural key.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { isValidEan13 } from "@smart-cart/contracts";
import { parseCsv } from "./csv.js";

const prisma = new PrismaClient();
const STORE_ID = "S-01";
const CART_COUNT = 20;

async function main() {
  await prisma.store.upsert({
    where: { id: STORE_ID },
    update: {},
    create: { id: STORE_ID, name: "DMart Pilot Store (demo)", city: "Mumbai" },
  });

  for (let n = 1; n <= CART_COUNT; n++) {
    const id = `C-${String(n).padStart(4, "0")}`;
    await prisma.cart.upsert({
      where: { id },
      update: {},
      create: { id, storeId: STORE_ID, qrCode: `smartcart://pair?cart=${id}&store=${STORE_ID}` },
    });
  }

  // Next to this file when run with tsx; two levels up when run compiled from dist/prisma.
  const here = dirname(fileURLToPath(import.meta.url));
  const csvPath = [join(here, "data/products.csv"), join(here, "../../prisma/data/products.csv")].find(existsSync);
  if (!csvPath) throw new Error("prisma/data/products.csv not found");
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  for (const r of rows) {
    if (!isValidEan13(r.barcode!)) throw new Error(`Invalid EAN-13 in seed: ${r.barcode}`);
    const fields = {
      name: r.name!,
      brand: r.brand || null,
      category: r.category!,
      hsnCode: r.hsn_code!,
      gstRateBp: Number(r.gst_rate_bp),
      weightG: r.weight_g ? Number(r.weight_g) : null,
    };
    const existing = await prisma.barcode.findUnique({ where: { code: r.barcode! } });
    const product = existing
      ? await prisma.product.update({ where: { id: existing.productId }, data: fields })
      : await prisma.product.create({ data: { ...fields, barcodes: { create: { code: r.barcode! } } } });

    const price = { mrpPaise: Number(r.mrp_paise), pricePaise: Number(r.price_paise) };
    const current = await prisma.storePrice.findFirst({
      where: { storeId: STORE_ID, productId: product.id },
      orderBy: { validFrom: "desc" },
    });
    if (!current || current.mrpPaise !== price.mrpPaise || current.pricePaise !== price.pricePaise) {
      await prisma.storePrice.create({ data: { storeId: STORE_ID, productId: product.id, ...price } });
    }

    await prisma.inventory.upsert({
      where: { storeId_productId: { storeId: STORE_ID, productId: product.id } },
      update: { aisle: r.aisle || null, shelf: r.shelf || null },
      create: {
        storeId: STORE_ID,
        productId: product.id,
        onHand: Number(r.on_hand),
        lowStockThreshold: Number(r.low_stock_threshold),
        aisle: r.aisle || null,
        shelf: r.shelf || null,
      },
    });
  }
  // Demo staff account. In AUTH_MODE=dev the dashboard signs in as "dev:staff-demo".
  // With Firebase, add real staff by inserting a staff row for their user.
  const staffUser = await prisma.user.upsert({
    where: { firebaseUid: "staff-demo" },
    update: {},
    create: { firebaseUid: "staff-demo", name: "Demo Store Manager" },
  });
  await prisma.staff.upsert({
    where: { userId_storeId: { userId: staffUser.id, storeId: STORE_ID } },
    update: {},
    create: { userId: staffUser.id, storeId: STORE_ID, role: "manager" },
  });

  console.log(`Seeded store ${STORE_ID}, ${CART_COUNT} carts, ${rows.length} products.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
