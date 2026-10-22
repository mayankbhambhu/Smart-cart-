// Runs against a real Postgres and Redis with the seed loaded (docker compose or CI services).
// Skipped when DATABASE_URL is not set so `pnpm test` works on a bare laptop.
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { DevTokenVerifier } from "../src/modules/auth/verifier.js";

const enabled = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

describe.skipIf(!enabled)("API against seeded database", () => {
  let prisma: PrismaClient;
  let redis: Redis;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    prisma = new PrismaClient();
    redis = new Redis(process.env.REDIS_URL!);
    app = await buildApp({ prisma, redis, verifier: new DevTokenVerifier(), corsOrigins: [] });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  });

  it("is ready when Postgres and Redis answer", async () => {
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ checks: { postgres: "ok", redis: "ok" } });
  });

  it("looks up a seeded product by barcode with its store price", async () => {
    const any = await prisma.barcode.findFirstOrThrow();
    const res = await app.inject({ method: "GET", url: `/v1/products/barcode/${any.code}?storeId=S-01` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.barcode).toBe(any.code);
    expect(body.pricePaise).toBeGreaterThan(0);
    expect(body.pricePaise).toBeLessThanOrEqual(body.mrpPaise);
  });

  it("returns 404 for an unknown barcode", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/products/barcode/2999999999999" });
    expect(res.statusCode).toBe(404);
  });

  it("keeps store inventory for staff only", async () => {
    const anon = await app.inject({ method: "GET", url: "/admin/v1/stores/S-01/inventory" });
    expect(anon.statusCode).toBe(401);
    const shopper = await app.inject({
      method: "GET",
      url: "/admin/v1/stores/S-01/inventory",
      headers: { authorization: "Bearer dev:not-staff" },
    });
    expect(shopper.statusCode).toBe(403);
  });

  it("lists store inventory and filters low stock", async () => {
    const headers = { authorization: "Bearer dev:staff-demo" };
    const all = await app.inject({ method: "GET", url: "/admin/v1/stores/S-01/inventory", headers });
    expect(all.statusCode).toBe(200);
    expect(all.json().items.length).toBeGreaterThanOrEqual(150);

    const low = await app.inject({ method: "GET", url: "/admin/v1/stores/S-01/inventory?lowStockOnly=false", headers });
    expect(low.json().items.length).toBe(all.json().items.length);
  });
});
