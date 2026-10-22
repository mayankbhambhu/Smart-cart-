import type { FastifyPluginAsync } from "fastify";
import type { CartService } from "./service.js";

export const cartAdminRoutes: FastifyPluginAsync<{ carts: CartService }> = async (app, { carts }) => {
  /** Dashboard: open cart sessions with shopper, item count and running total. */
  app.get<{ Params: { storeId: string } }>(
    "/stores/:storeId/carts",
    { preHandler: [app.authenticate, app.requireStaff] },
    async (req) => ({ storeId: req.params.storeId, sessions: await carts.activeInStore(req.params.storeId) }),
  );
};
