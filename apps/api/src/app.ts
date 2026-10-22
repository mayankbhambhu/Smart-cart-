import cors from "@fastify/cors";
import type { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyServerOptions } from "fastify";
import type { Redis } from "ioredis";
import { catalogRoutes } from "./modules/catalog/routes.js";
import { healthRoutes } from "./modules/health/routes.js";
import { inventoryRoutes } from "./modules/inventory/routes.js";
import { storeRoutes } from "./modules/stores/routes.js";

export type AppDeps = {
  prisma: PrismaClient;
  redis: Redis;
  corsOrigins: string[];
};

declare module "fastify" {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

export async function buildApp(deps: AppDeps, opts: FastifyServerOptions = {}) {
  const app = Fastify({ ...opts, genReqId: () => crypto.randomUUID() });
  app.decorate("deps", deps);

  await app.register(cors, { origin: deps.corsOrigins });

  // Module boundaries follow docs/architecture.md: each module owns its tables.
  await app.register(healthRoutes);
  await app.register(storeRoutes, { prefix: "/v1" });
  await app.register(catalogRoutes, { prefix: "/v1" });
  // TODO(milestone 2): require a verified Firebase token with a staff role on /admin routes.
  await app.register(inventoryRoutes, { prefix: "/admin/v1" });

  return app;
}
