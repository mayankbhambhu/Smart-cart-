import { Prisma, type PrismaClient } from "@prisma/client";
import type { CartLine, CartSnapshot, EventSource } from "@smart-cart/contracts";
import type { Redis } from "ioredis";
import { cartTotals, lineAmounts } from "../../lib/money.js";
import { currentPrices } from "../../lib/pricing.js";
import { makeEvent, roomsFor, type Publish } from "../realtime/publisher.js";
import { CartError } from "./errors.js";

const LIVE_TTL_SECONDS = 4 * 60 * 60;
const itemsKey = (sessionId: string) => `cart:${sessionId}:items`;

type SessionRow = Prisma.CartSessionGetPayload<{ include: { cart: true } }>;

/**
 * Owns carts, cart sessions and the live cart. Every change is appended to cart_events
 * (the durable record) and then applied to a Redis hash productId -> qty (the fast projection).
 * If Redis loses a cart, it is rebuilt by replaying cart_events.
 */
export class CartService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    private readonly publish: Publish,
  ) {}

  /** Opens a session on a physical cart for this user. Re-pairing the same cart returns the same session. */
  async pair(userId: string, cartCode: string, storeId: string, source: EventSource = "phone") {
    const cart = await this.prisma.cart.findUnique({ where: { id: cartCode } });
    if (!cart || cart.storeId !== storeId) throw new CartError(404, "cart_not_found");
    if (cart.status === "maintenance") throw new CartError(409, "cart_in_maintenance");

    const mine = await this.prisma.cartSession.findFirst({
      where: { userId, status: { in: ["active", "checking_out"] } },
    });
    if (mine) {
      if (mine.cartId === cartCode) return this.snapshot(mine.id);
      throw new CartError(409, "already_shopping", { sessionId: mine.id, cartCode: mine.cartId });
    }

    let session;
    try {
      session = await this.prisma.$transaction(async (tx) => {
        // The partial unique index cart_sessions_one_open_per_cart makes a concurrent pair fail here.
        const created = await tx.cartSession.create({ data: { cartId: cartCode, userId } });
        await tx.cart.update({ where: { id: cartCode }, data: { status: "in_use" } });
        await tx.cartEvent.create({ data: { sessionId: created.id, type: "session.started", source } });
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new CartError(409, "cart_in_use");
      throw err;
    }

    this.publish(
      makeEvent("cart.session_started", {
        storeId,
        cartId: cartCode,
        source,
        data: { sessionId: session.id, cartCode, userId },
      }),
      roomsFor.store(storeId),
    );
    return this.snapshot(session.id);
  }

  /** Loads a session the user owns, or throws 404 (never reveals other people's sessions). */
  async ownedSession(sessionId: string, userId: string): Promise<SessionRow> {
    const session = await this.prisma.cartSession.findUnique({
      where: { id: sessionId },
      include: { cart: true },
    });
    if (!session || session.userId !== userId) throw new CartError(404, "session_not_found");
    return session;
  }

  async snapshot(sessionId: string): Promise<CartSnapshot> {
    const session = await this.prisma.cartSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { cart: true },
    });
    const quantities = await this.quantities(session);
    const lines = await this.buildLines(session.cart.storeId, quantities);
    return {
      sessionId: session.id,
      cartCode: session.cartId,
      storeId: session.cart.storeId,
      status: session.status,
      lines,
      totals: cartTotals(lines),
      updatedAt: new Date().toISOString(),
    };
  }

  async addItem(
    session: SessionRow,
    input: { barcode: string; qty: number; requestId: string },
    source: EventSource = "phone",
  ) {
    assertActive(session);
    const storeId = session.cart.storeId;
    const barcode = await this.prisma.barcode.findUnique({ where: { code: input.barcode } });
    if (!barcode) throw new CartError(404, "product_not_found");
    const productId = barcode.productId;

    let stock: StockRow | null;
    try {
      stock = await this.prisma.$transaction(async (tx) => {
        await tx.cartEvent.create({
          data: { sessionId: session.id, type: "item.added", productId, qty: input.qty, source, requestId: input.requestId },
        });
        // Soft reservation: stock is deducted for real only when the order is paid.
        const rows = await tx.$queryRaw<StockRow[]>`
          UPDATE inventory SET reserved = reserved + ${input.qty}, updated_at = now()
          WHERE store_id = ${storeId} AND product_id = ${productId}
          RETURNING on_hand AS "onHand", reserved, low_stock_threshold AS "threshold"`;
        return rows[0] ?? null;
      });
    } catch (err) {
      // Same requestId seen before: the add already happened, so report the current state.
      if (isUniqueViolation(err)) return this.lineResult(session, productId);
      throw err;
    }

    await this.applyDelta(session, productId, input.qty);
    const result = await this.lineResult(session, productId);
    if (!result.line) throw new Error("added line missing from cart");

    this.publish(
      makeEvent("cart.item_added", {
        storeId,
        cartId: session.cartId,
        source,
        data: { sessionId: session.id, line: result.line, totals: result.totals },
      }),
      roomsFor.cart(session.id, storeId),
    );
    if (stock) this.publishStock(storeId, productId, stock, input.qty, result.line.name);
    return result;
  }

  async removeItem(
    session: SessionRow,
    input: { productId: string; qty: number | "all"; requestId: string },
    source: EventSource = "phone",
  ) {
    assertActive(session);
    const storeId = session.cart.storeId;
    const current = (await this.quantities(session)).get(input.productId) ?? 0;
    if (current === 0) throw new CartError(404, "item_not_in_cart");
    const qty = input.qty === "all" ? current : Math.min(input.qty, current);

    let stock: StockRow | null;
    try {
      stock = await this.prisma.$transaction(async (tx) => {
        await tx.cartEvent.create({
          data: { sessionId: session.id, type: "item.removed", productId: input.productId, qty, source, requestId: input.requestId },
        });
        const rows = await tx.$queryRaw<StockRow[]>`
          UPDATE inventory SET reserved = GREATEST(reserved - ${qty}, 0), updated_at = now()
          WHERE store_id = ${storeId} AND product_id = ${input.productId}
          RETURNING on_hand AS "onHand", reserved, low_stock_threshold AS "threshold"`;
        return rows[0] ?? null;
      });
    } catch (err) {
      if (isUniqueViolation(err)) return this.lineResult(session, input.productId);
      throw err;
    }

    await this.applyDelta(session, input.productId, -qty);
    const result = await this.lineResult(session, input.productId);
    this.publish(
      makeEvent("cart.item_removed", {
        storeId,
        cartId: session.cartId,
        source,
        data: { sessionId: session.id, productId: input.productId, line: result.line, totals: result.totals },
      }),
      roomsFor.cart(session.id, storeId),
    );
    if (stock) this.publishStock(storeId, input.productId, stock, 0, null);
    return result;
  }

  /** Ends an open session without an order: releases reservations and frees the cart. */
  async endSession(session: SessionRow, reason: "cancelled" | "abandoned", source: EventSource = "phone") {
    if (session.status !== "active") throw new CartError(409, "session_not_active", { status: session.status });
    const storeId = session.cart.storeId;
    const quantities = await this.quantities(session);

    await this.prisma.$transaction(async (tx) => {
      for (const [productId, qty] of quantities) {
        await tx.$executeRaw`
          UPDATE inventory SET reserved = GREATEST(reserved - ${qty}, 0), updated_at = now()
          WHERE store_id = ${storeId} AND product_id = ${productId}`;
      }
      await tx.cartEvent.create({ data: { sessionId: session.id, type: `session.${reason}`, source } });
      await tx.cartSession.update({
        where: { id: session.id },
        data: { status: "abandoned", endedAt: new Date() },
      });
      await tx.cart.update({ where: { id: session.cartId }, data: { status: "available" } });
    });
    await this.redis.del(itemsKey(session.id));

    this.publish(
      makeEvent("cart.session_ended", {
        storeId,
        cartId: session.cartId,
        source,
        data: { sessionId: session.id, reason },
      }),
      roomsFor.cart(session.id, storeId),
    );
  }

  /** Abandons active sessions with no activity for idleMinutes. Returns how many were ended. */
  async sweepIdle(idleMinutes: number, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - idleMinutes * 60_000);
    const idle = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM cart_sessions s
      WHERE s.status = 'active'
        AND COALESCE((SELECT max(e.at) FROM cart_events e WHERE e.session_id = s.id), s.started_at) < ${cutoff}`;
    for (const { id } of idle) {
      const session = await this.prisma.cartSession.findUniqueOrThrow({ where: { id }, include: { cart: true } });
      await this.endSession(session, "abandoned", "system");
    }
    return idle.length;
  }

  /** Open sessions in a store, for the dashboard. */
  async activeInStore(storeId: string) {
    const sessions = await this.prisma.cartSession.findMany({
      where: { status: { in: ["active", "checking_out"] }, cart: { storeId } },
      include: { cart: true, user: { select: { name: true } } },
      orderBy: { startedAt: "asc" },
    });
    return Promise.all(
      sessions.map(async (s) => {
        const snap = await this.snapshot(s.id);
        return {
          sessionId: s.id,
          cartCode: s.cartId,
          shopperName: s.user.name,
          status: s.status,
          startedAt: s.startedAt.toISOString(),
          totals: snap.totals,
        };
      }),
    );
  }

  // --- internals ---

  /** productId -> qty from Redis, rebuilt from cart_events if the hash is missing. */
  private async quantities(session: { id: string; status: string }): Promise<Map<string, number>> {
    const key = itemsKey(session.id);
    const [hash, exists] = await Promise.all([this.redis.hgetall(key), this.redis.exists(key)]);
    if (exists) {
      return new Map(Object.entries(hash).filter(([k]) => k !== "_").map(([k, v]) => [k, Number(v)]));
    }
    if (session.status !== "active" && session.status !== "checking_out") return this.replay(session.id);

    const rebuilt = await this.replay(session.id);
    // A marker field keeps an empty cart's hash in existence so we don't replay on every read.
    const pipeline = this.redis.multi().del(key).hset(key, "_", "0");
    for (const [productId, qty] of rebuilt) pipeline.hset(key, productId, String(qty));
    await pipeline.expire(key, LIVE_TTL_SECONDS).exec();
    return rebuilt;
  }

  private async replay(sessionId: string): Promise<Map<string, number>> {
    const events = await this.prisma.cartEvent.findMany({
      where: { sessionId, type: { in: ["item.added", "item.removed"] } },
      orderBy: { at: "asc" },
    });
    const q = new Map<string, number>();
    for (const e of events) {
      if (!e.productId || !e.qty) continue;
      const next = (q.get(e.productId) ?? 0) + (e.type === "item.added" ? e.qty : -e.qty);
      if (next > 0) q.set(e.productId, next);
      else q.delete(e.productId);
    }
    return q;
  }

  private async applyDelta(session: SessionRow, productId: string, delta: number) {
    const key = itemsKey(session.id);
    await this.quantities(session); // make sure the projection exists before mutating it
    const next = await this.redis.hincrby(key, productId, delta);
    if (next <= 0) await this.redis.hdel(key, productId);
    await this.redis.expire(key, LIVE_TTL_SECONDS);
  }

  private async lineResult(session: SessionRow, productId: string) {
    const quantities = await this.quantities(session);
    const lines = await this.buildLines(session.cart.storeId, quantities);
    return { line: lines.find((l) => l.productId === productId) ?? null, totals: cartTotals(lines) };
  }

  private async buildLines(storeId: string, quantities: Map<string, number>): Promise<CartLine[]> {
    const entries = [...quantities].filter(([, qty]) => qty > 0);
    if (entries.length === 0) return [];
    const ids = entries.map(([id]) => id);
    const [products, prices] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: ids } } }),
      currentPrices(this.prisma, storeId, ids),
    ]);
    const byId = new Map(products.map((p) => [p.id, p]));
    return entries
      .map(([productId, qty]) => {
        const p = byId.get(productId);
        const price = prices.get(productId);
        if (!p || !price) return null;
        const priced = { qty, unitPricePaise: price.pricePaise, gstRateBp: p.gstRateBp };
        return {
          productId,
          name: p.name,
          brand: p.brand,
          imageUrl: p.imageUrl,
          ...priced,
          ...lineAmounts(priced),
        } satisfies CartLine;
      })
      .filter((l): l is CartLine => l !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private publishStock(storeId: string, productId: string, stock: StockRow, addedQty: number, name: string | null) {
    this.publish(
      makeEvent("inventory.updated", {
        storeId,
        cartId: null,
        source: "system",
        data: { productId, onHand: stock.onHand, reserved: stock.reserved },
      }),
      roomsFor.store(storeId),
    );
    const available = stock.onHand - stock.reserved;
    const before = available + addedQty;
    // Alert once, when an add takes available stock across the threshold.
    if (addedQty > 0 && name && available <= stock.threshold && before > stock.threshold) {
      this.publish(
        makeEvent("inventory.low_stock", {
          storeId,
          cartId: null,
          source: "system",
          data: { productId, name, onHand: stock.onHand, available, threshold: stock.threshold },
        }),
        roomsFor.store(storeId),
      );
    }
  }
}

type StockRow = { onHand: number; reserved: number; threshold: number };

function assertActive(session: { status: string }) {
  if (session.status !== "active") throw new CartError(409, "session_not_active", { status: session.status });
}

function isUniqueViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return true;
    // Raw queries surface Postgres errors as P2010 with the SQLSTATE in meta.
    if (err.code === "P2010" && (err.meta as { code?: string } | undefined)?.code === "23505") return true;
  }
  return false;
}
