import cors from "@fastify/cors";
import type { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyServerOptions } from "fastify";
import type { Redis } from "ioredis";
import { authPlugin } from "./modules/auth/plugin.js";
import type { TokenVerifier } from "./modules/auth/verifier.js";
import { cartAdminRoutes } from "./modules/cart/admin-routes.js";
import { cartRoutes } from "./modules/cart/routes.js";
import { CartService } from "./modules/cart/service.js";
import { catalogRoutes } from "./modules/catalog/routes.js";
import { healthRoutes } from "./modules/health/routes.js";
import { inventoryRoutes } from "./modules/inventory/routes.js";
import { RealtimeServer } from "./modules/realtime/server.js";
import { storeRoutes } from "./modules/stores/routes.js";

export type AppDeps = {
  prisma: PrismaClient;
  redis: Redis;
  verifier: TokenVerifier;
  corsOrigins: string[];
  /** Use the Socket.IO Redis adapter (needed with more than one API instance). */
  realtimeRedisAdapter?: boolean;
};

declare module "fastify" {
  interface FastifyInstance {
    deps: AppDeps;
    realtime: RealtimeServer;
    carts: CartService;
  }
}

export async function buildApp(deps: AppDeps, opts: FastifyServerOptions = {}) {
  const app = Fastify({ ...opts, genReqId: () => crypto.randomUUID() });
  app.decorate("deps", deps);

  await app.register(cors, { origin: deps.corsOrigins });
  await app.register(authPlugin, { verifier: deps.verifier });

  const realtime = new RealtimeServer(app.server, {
    prisma: deps.prisma,
    verifier: deps.verifier,
    corsOrigins: deps.corsOrigins,
    redis: deps.realtimeRedisAdapter ? deps.redis : undefined,
  });
  const carts = new CartService(deps.prisma, deps.redis, realtime.publish);
  realtime.attach(carts);
  app.decorate("realtime", realtime);
  app.decorate("carts", carts);
  app.addHook("onClose", async () => realtime.close());

  // Module boundaries follow docs/architecture.md: each module owns its tables.
  await app.register(healthRoutes);
  await app.register(storeRoutes, { prefix: "/v1" });
  await app.register(catalogRoutes, { prefix: "/v1" });
  await app.register(cartRoutes, { prefix: "/v1", carts });
  await app.register(cartAdminRoutes, { prefix: "/admin/v1", carts });
  await app.register(inventoryRoutes, { prefix: "/admin/v1" });

  return app;
}
