import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  /** Liveness: the process is up. Used by the ECS container health check. */
  app.get("/healthz", async () => ({ status: "ok" }));

  /** Readiness: Postgres and Redis both answer. Used by the load balancer target group. */
  app.get("/readyz", async (_req, reply) => {
    const { prisma, redis } = app.deps;
    const [db, cache] = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, redis.ping()]);
    const checks = {
      postgres: db.status === "fulfilled" ? "ok" : "down",
      redis: cache.status === "fulfilled" ? "ok" : "down",
    };
    const ok = Object.values(checks).every((v) => v === "ok");
    return reply.code(ok ? 200 : 503).send({ status: ok ? "ok" : "degraded", checks });
  });
};
