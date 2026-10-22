import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { currentPrices } from "../../lib/pricing.js";

const Params = z.object({ storeId: z.string() });
const Query = z.object({
  q: z.string().trim().optional(),
  lowStockOnly: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

export const inventoryRoutes: FastifyPluginAsync = async (app) => {
  /** Dashboard inventory table: stock, reservations, thresholds and location for every product. */
  app.get("/stores/:storeId/inventory", async (req, reply) => {
    const params = Params.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_store" });
    const { q, lowStockOnly } = Query.parse(req.query);
    const { storeId } = params.data;
    const { prisma } = app.deps;

    const rows = await prisma.inventory.findMany({
      where: {
        storeId,
        ...(q ? { product: { name: { contains: q, mode: "insensitive" } } } : {}),
      },
      include: { product: { include: { barcodes: { take: 1 } } } },
      orderBy: [{ aisle: "asc" }, { product: { name: "asc" } }],
    });
    const prices = await currentPrices(prisma, storeId, rows.map((r) => r.productId));

    const items = rows
      .map((r) => {
        const available = r.onHand - r.reserved;
        return {
          productId: r.productId,
          name: r.product.name,
          brand: r.product.brand,
          category: r.product.category,
          barcode: r.product.barcodes[0]?.code ?? null,
          pricePaise: prices.get(r.productId)?.pricePaise ?? null,
          onHand: r.onHand,
          reserved: r.reserved,
          available,
          lowStockThreshold: r.lowStockThreshold,
          lowStock: available <= r.lowStockThreshold,
          aisle: r.aisle,
          shelf: r.shelf,
          updatedAt: r.updatedAt.toISOString(),
        };
      })
      .filter((i) => !lowStockOnly || i.lowStock);

    return { storeId, items };
  });
};
