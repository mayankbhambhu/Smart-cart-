import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  /** Comma-separated list of origins allowed to call the API from a browser. */
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  /**
   * firebase: verify Firebase ID tokens (production).
   * dev: trust "dev:<uid>" bearer tokens so the app can be tested before Firebase is set up.
   */
  AUTH_MODE: z.enum(["firebase", "dev"]).default("dev"),
  FIREBASE_PROJECT_ID: z.string().optional(),
  /** Minutes a cart session can sit idle before it is abandoned and its reservations released. */
  CART_IDLE_MINUTES: z.coerce.number().int().positive().default(30),
});
export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  const config = parsed.data;
  if (config.AUTH_MODE === "firebase" && !config.FIREBASE_PROJECT_ID) {
    throw new Error("FIREBASE_PROJECT_ID is required when AUTH_MODE=firebase");
  }
  if (config.NODE_ENV === "production" && config.AUTH_MODE === "dev") {
    throw new Error("AUTH_MODE=dev is not allowed in production");
  }
  return config;
}
