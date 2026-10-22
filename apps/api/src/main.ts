import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { DevTokenVerifier, FirebaseTokenVerifier } from "./modules/auth/verifier.js";

const config = loadConfig();
const prisma = new PrismaClient();
const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
const verifier =
  config.AUTH_MODE === "firebase" ? new FirebaseTokenVerifier(config.FIREBASE_PROJECT_ID!) : new DevTokenVerifier();

await redis.connect();

const app = await buildApp(
  {
    prisma,
    redis,
    verifier,
    corsOrigins: config.CORS_ORIGINS.split(",").map((s) => s.trim()),
    realtimeRedisAdapter: true,
  },
  {
    logger: {
      level: config.LOG_LEVEL,
      ...(config.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
    },
  },
);
if (config.AUTH_MODE === "dev") app.log.warn("AUTH_MODE=dev: bearer tokens are not verified");

// Abandon idle carts so their stock reservations are released. Safe to run on every instance.
const sweep = setInterval(() => {
  app.carts
    .sweepIdle(config.CART_IDLE_MINUTES)
    .then((n) => n > 0 && app.log.info({ abandoned: n }, "abandoned idle cart sessions"))
    .catch((err) => app.log.error({ err }, "idle cart sweep failed"));
}, 60_000);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  clearInterval(sweep);
  await app.close();
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.PORT, host: config.HOST });
