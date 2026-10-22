import type { PrismaClient } from "@prisma/client";

/** The price in force for each product at a store: the latest store_prices row by valid_from. */
export async function currentPrices(prisma: PrismaClient, storeId: string, productIds: string[]) {
  if (productIds.length === 0) return new Map<string, { mrpPaise: number; pricePaise: number }>();
  const rows = await prisma.storePrice.findMany({
    where: { storeId, productId: { in: productIds }, validFrom: { lte: new Date() } },
    orderBy: { validFrom: "desc" },
    distinct: ["productId"],
    select: { productId: true, mrpPaise: true, pricePaise: true },
  });
  return new Map(rows.map((r) => [r.productId, { mrpPaise: r.mrpPaise, pricePaise: r.pricePaise }]));
}
