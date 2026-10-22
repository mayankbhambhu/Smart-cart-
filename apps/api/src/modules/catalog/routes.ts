import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { currentPrices } from "../../lib/pricing.js";

const Params = z.object({ code: z.string().regex(/^\d{8,14}$/) });
const Query = z.object({ storeId: z.string().default("S-01") });

export const catalogRoutes: FastifyPluginAsync = async (app) => {
  /** Product preview shown on the phone before the shopper confirms adding it. */
  app.get("/products/barcode/:code", async (req, reply) => {
    const params = Params.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_barcode" });
    const { storeId } = Query.parse(req.query);

    const barcode = await app.deps.prisma.barcode.findUnique({
      where: { code: params.data.code },
      include: { product: { include: { inventory: { where: { storeId } } } } },
    });
    if (!barcode) return reply.code(404).send({ error: "product_not_found" });

    const { product } = barcode;
    const price = (await currentPrices(app.deps.prisma, storeId, [product.id])).get(product.id);
    if (!price) return reply.code(404).send({ error: "not_sold_in_store" });
    const stock = product.inventory[0];

    return {
      productId: product.id,
      barcode: barcode.code,
      name: product.name,
      brand: product.brand,
      category: product.category,
      imageUrl: product.imageUrl,
      gstRateBp: product.gstRateBp,
      mrpPaise: price.mrpPaise,
      pricePaise: price.pricePaise,
      // Guardrail from the brief: only state availability from verified inventory.
      inStock: stock ? stock.onHand - stock.reserved > 0 : null,
      aisle: stock?.aisle ?? null,
    };
  });
};
