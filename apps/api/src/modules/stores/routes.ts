import type { FastifyPluginAsync } from "fastify";

export const storeRoutes: FastifyPluginAsync = async (app) => {
  /** Stores the shopper can pick on the home screen. */
  app.get("/stores", async () => {
    const stores = await app.deps.prisma.store.findMany({
      select: { id: true, name: true, city: true },
      orderBy: { id: "asc" },
    });
    return { stores };
  });
};
