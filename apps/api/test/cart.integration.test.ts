// Cart flows against a real Postgres and Redis with the seed loaded. Each test makes its own
// cart and shopper so tests do not depend on each other or on the seeded carts.
import { PrismaClient } from "@prisma/client";
import type { SmartCartEvent } from "@smart-cart/contracts";
import { Redis } from "ioredis";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { DevTokenVerifier } from "../src/modules/auth/verifier.js";

const enabled = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const STORE = "S-01";

describe.skipIf(!enabled)("cart sessions", () => {
  let prisma: PrismaClient;
  let redis: Redis;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let baseUrl: string;
  let milk: { code: string; productId: string };
  let dal: { code: string; productId: string };

  beforeAll(async () => {
    prisma = new PrismaClient();
    redis = new Redis(process.env.REDIS_URL!);
    app = await buildApp({ prisma, redis, verifier: new DevTokenVerifier(), corsOrigins: [] });
    await app.listen({ port: 0, host: "127.0.0.1" });
    baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const find = async (name: string) => {
      const p = await prisma.product.findFirstOrThrow({ where: { name }, include: { barcodes: true } });
      return { code: p.barcodes[0]!.code, productId: p.id };
    };
    milk = await find("Amul Toned Milk 500 ml");
    dal = await find("Tata Sampann Toor Dal 1 kg");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  });

  async function newCart() {
    const id = `C-9${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
    await prisma.cart.create({ data: { id, storeId: STORE, qrCode: `smartcart://pair?cart=${id}&store=${STORE}` } });
    return id;
  }

  const shopper = () => `Bearer dev:t-${crypto.randomUUID().slice(0, 8)}`;

  async function pair(auth: string, cartCode: string) {
    return app.inject({
      method: "POST",
      url: "/v1/carts/pair",
      headers: { authorization: auth },
      payload: { cartCode, storeId: STORE },
    });
  }

  async function add(auth: string, sessionId: string, barcode: string, qty = 1, requestId = crypto.randomUUID()) {
    return app.inject({
      method: "POST",
      url: `/v1/carts/${sessionId}/items`,
      headers: { authorization: auth },
      payload: { barcode, qty, requestId },
    });
  }

  const reserved = async (productId: string) =>
    (await prisma.inventory.findUniqueOrThrow({ where: { storeId_productId: { storeId: STORE, productId } } }))
      .reserved;

  it("requires sign-in", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/carts/pair", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("pairs a cart, and the same shopper re-pairing gets the same session", async () => {
    const auth = shopper();
    const cart = await newCart();
    const first = await pair(auth, cart);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ cartCode: cart, status: "active", lines: [] });
    const again = await pair(auth, cart);
    expect(again.json().sessionId).toBe(first.json().sessionId);
  });

  it("refuses a cart someone else is using", async () => {
    const cart = await newCart();
    expect((await pair(shopper(), cart)).statusCode).toBe(200);
    const res = await pair(shopper(), cart);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("cart_in_use");
  });

  it("adds items with GST-inclusive totals, reserving stock", async () => {
    const auth = shopper();
    const { sessionId } = (await pair(auth, await newCart())).json();
    const before = await reserved(dal.productId);

    await add(auth, sessionId, milk.code, 2);
    const res = await add(auth, sessionId, dal.code, 1);
    expect(res.statusCode).toBe(200);

    const snap = (await app.inject({ method: "GET", url: `/v1/carts/${sessionId}`, headers: { authorization: auth } })).json();
    expect(snap.totals.itemCount).toBe(3);
    const sum = snap.lines.reduce((s: number, l: { lineTotalPaise: number }) => s + l.lineTotalPaise, 0);
    expect(snap.totals.totalPaise).toBe(sum);
    expect(snap.totals.subtotalPaise + snap.totals.taxPaise).toBe(snap.totals.totalPaise);
    expect(await reserved(dal.productId)).toBe(before + 1);
  });

  it("applies a retried add (same requestId) once", async () => {
    const auth = shopper();
    const { sessionId } = (await pair(auth, await newCart())).json();
    const requestId = crypto.randomUUID();
    await add(auth, sessionId, milk.code, 1, requestId);
    const retry = await add(auth, sessionId, milk.code, 1, requestId);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().line.qty).toBe(1);
  });

  it("removes one unit or the whole line and releases stock", async () => {
    const auth = shopper();
    const { sessionId } = (await pair(auth, await newCart())).json();
    const before = await reserved(milk.productId);
    await add(auth, sessionId, milk.code, 3);

    const one = await app.inject({
      method: "DELETE",
      url: `/v1/carts/${sessionId}/items/${milk.productId}?requestId=${crypto.randomUUID()}`,
      headers: { authorization: auth },
    });
    expect(one.json().line.qty).toBe(2);

    const all = await app.inject({
      method: "DELETE",
      url: `/v1/carts/${sessionId}/items/${milk.productId}?qty=all&requestId=${crypto.randomUUID()}`,
      headers: { authorization: auth },
    });
    expect(all.json().line).toBeNull();
    expect(all.json().totals.itemCount).toBe(0);
    expect(await reserved(milk.productId)).toBe(before);
  });

  it("hides another shopper's session", async () => {
    const { sessionId } = (await pair(shopper(), await newCart())).json();
    const res = await add(shopper(), sessionId, milk.code);
    expect(res.statusCode).toBe(404);
  });

  it("rebuilds the live cart from the event log if Redis loses it", async () => {
    const auth = shopper();
    const { sessionId } = (await pair(auth, await newCart())).json();
    await add(auth, sessionId, milk.code, 2);
    await redis.del(`cart:${sessionId}:items`);
    const snap = (await app.inject({ method: "GET", url: `/v1/carts/${sessionId}`, headers: { authorization: auth } })).json();
    expect(snap.totals.itemCount).toBe(2);
  });

  it("cancelling frees the cart and its reservations", async () => {
    const auth = shopper();
    const cart = await newCart();
    const { sessionId } = (await pair(auth, cart)).json();
    const before = await reserved(dal.productId);
    await add(auth, sessionId, dal.code, 2);

    const res = await app.inject({ method: "POST", url: `/v1/carts/${sessionId}/cancel`, headers: { authorization: auth } });
    expect(res.statusCode).toBe(200);
    expect(await reserved(dal.productId)).toBe(before);
    expect((await prisma.cart.findUniqueOrThrow({ where: { id: cart } })).status).toBe("available");
    expect((await pair(shopper(), cart)).statusCode).toBe(200);
  });

  it("abandons idle sessions", async () => {
    const auth = shopper();
    const { sessionId } = (await pair(auth, await newCart())).json();
    await add(auth, sessionId, milk.code);
    const later = new Date(Date.now() + 31 * 60_000);
    expect(await app.carts.sweepIdle(30, later)).toBeGreaterThanOrEqual(1);
    const session = await prisma.cartSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe("abandoned");
  });

  it("shows open sessions to staff", async () => {
    const { sessionId } = (await pair(shopper(), await newCart())).json();
    const res = await app.inject({
      method: "GET",
      url: `/admin/v1/stores/${STORE}/carts`,
      headers: { authorization: "Bearer dev:staff-demo" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sessions.map((s: { sessionId: string }) => s.sessionId)).toContain(sessionId);
  });

  describe("real-time", () => {
    function socketFor(auth: string): Promise<Socket> {
      return new Promise((resolve, reject) => {
        const s = connect(baseUrl, { auth: { token: auth.replace("Bearer ", "") }, transports: ["websocket"] });
        s.on("connect", () => resolve(s));
        s.on("connect_error", reject);
      });
    }

    function nextEvent(s: Socket, type: SmartCartEvent["type"]): Promise<SmartCartEvent> {
      return new Promise((resolve) => {
        const handler = (e: SmartCartEvent) => {
          if (e.type === type) {
            s.off("event", handler);
            resolve(e);
          }
        };
        s.on("event", handler);
      });
    }

    it("rejects a socket without a valid token", async () => {
      await expect(socketFor("Bearer nope")).rejects.toThrow("unauthenticated");
    });

    it("sends a snapshot on join and pushes adds to the shopper and the store", async () => {
      const auth = shopper();
      const { sessionId } = (await pair(auth, await newCart())).json();

      const phone = await socketFor(auth);
      const staff = await socketFor("Bearer dev:staff-demo");
      try {
        const snapshot = nextEvent(phone, "cart.snapshot");
        expect(await phone.emitWithAck("join", { room: "cart", sessionId })).toEqual({ ok: true });
        expect((await snapshot).data).toMatchObject({ sessionId });
        expect(await staff.emitWithAck("join", { room: "store", storeId: STORE })).toEqual({ ok: true });

        const onPhone = nextEvent(phone, "cart.item_added");
        const onStore = nextEvent(staff, "cart.item_added");
        const onStock = nextEvent(staff, "inventory.updated");
        await add(auth, sessionId, milk.code, 2);

        const e = await onPhone;
        expect(e.source).toBe("phone");
        expect(e.type === "cart.item_added" && e.data.line.qty).toBe(2);
        expect((await onStore).eventId).toBe(e.eventId);
        expect((await onStock).type).toBe("inventory.updated");
      } finally {
        phone.disconnect();
        staff.disconnect();
      }
    });

    it("keeps shoppers out of other carts and the store room", async () => {
      const { sessionId } = (await pair(shopper(), await newCart())).json();
      const intruder = await socketFor(shopper());
      try {
        expect(await intruder.emitWithAck("join", { room: "cart", sessionId })).toEqual({ ok: false, error: "not_found" });
        expect(await intruder.emitWithAck("join", { room: "store", storeId: STORE })).toEqual({ ok: false, error: "forbidden" });
      } finally {
        intruder.disconnect();
      }
    });
  });
});
