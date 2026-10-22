import { AddItemRequest, PairCartRequest } from "@smart-cart/contracts";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { CartError } from "./errors.js";
import type { CartService } from "./service.js";

const SessionParams = z.object({ sessionId: z.uuid() });
const RemoveParams = SessionParams.extend({ productId: z.uuid() });
const RemoveQuery = z.object({
  qty: z.union([z.literal("all"), z.coerce.number().int().min(1).max(50)]).default(1),
  requestId: z.uuid(),
});

export function sendCartError(reply: FastifyReply, err: unknown) {
  if (err instanceof CartError) return reply.code(err.status).send({ error: err.code, ...err.details });
  if (err instanceof z.ZodError) return reply.code(400).send({ error: "invalid_request", issues: err.issues });
  throw err;
}

export const cartRoutes: FastifyPluginAsync<{ carts: CartService }> = async (app, { carts }) => {
  app.addHook("preHandler", app.authenticate);

  app.post("/carts/pair", async (req, reply) => {
    try {
      const body = PairCartRequest.parse(req.body);
      return await carts.pair(req.user!.id, body.cartCode, body.storeId);
    } catch (err) {
      return sendCartError(reply, err);
    }
  });

  app.get("/carts/:sessionId", async (req, reply) => {
    try {
      const { sessionId } = SessionParams.parse(req.params);
      await carts.ownedSession(sessionId, req.user!.id);
      return await carts.snapshot(sessionId);
    } catch (err) {
      return sendCartError(reply, err);
    }
  });

  app.post("/carts/:sessionId/items", async (req, reply) => {
    try {
      const { sessionId } = SessionParams.parse(req.params);
      const body = AddItemRequest.parse(req.body);
      const session = await carts.ownedSession(sessionId, req.user!.id);
      return await carts.addItem(session, body);
    } catch (err) {
      return sendCartError(reply, err);
    }
  });

  app.delete("/carts/:sessionId/items/:productId", async (req, reply) => {
    try {
      const { sessionId, productId } = RemoveParams.parse(req.params);
      const { qty, requestId } = RemoveQuery.parse(req.query);
      const session = await carts.ownedSession(sessionId, req.user!.id);
      return await carts.removeItem(session, { productId, qty, requestId });
    } catch (err) {
      return sendCartError(reply, err);
    }
  });

  /** Shopper leaves without buying: releases the cart and the stock it held. */
  app.post("/carts/:sessionId/cancel", async (req, reply) => {
    try {
      const { sessionId } = SessionParams.parse(req.params);
      const session = await carts.ownedSession(sessionId, req.user!.id);
      await carts.endSession(session, "cancelled");
      return { ok: true };
    } catch (err) {
      return sendCartError(reply, err);
    }
  });

  /** The shopper's open session, if any, so the app can resume after a restart. */
  app.get("/me/cart", async (req) => {
    const session = await app.deps.prisma.cartSession.findFirst({
      where: { userId: req.user!.id, status: { in: ["active", "checking_out"] } },
    });
    return { session: session ? await carts.snapshot(session.id) : null };
  });
};
