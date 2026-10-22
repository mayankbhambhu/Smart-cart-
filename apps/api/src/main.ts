import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const prisma = new PrismaClient();
const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });

const app = await buildApp(
  { prisma, redis, corsOrigins: config.CORS_ORIGINS.split(",").map((s) => s.trim()) },
  {
    logger: {
      level: config.LOG_LEVEL,
      ...(config.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
    },
  },
);

await redis.connect();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.PORT, host: config.HOST });
