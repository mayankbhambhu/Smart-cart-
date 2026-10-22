import type { PrismaClient } from "@prisma/client";
import { createAdapter } from "@socket.io/redis-adapter";
import { rooms, type SmartCartEvent } from "@smart-cart/contracts";
import type { Server as HttpServer } from "node:http";
import type { Redis } from "ioredis";
import { Server } from "socket.io";
import { z } from "zod";
import { isStaff, upsertUser, type AuthUser } from "../auth/plugin.js";
import { AuthError, type TokenVerifier } from "../auth/verifier.js";
import type { CartService } from "../cart/service.js";
import type { Publish } from "./publisher.js";

const JoinRequest = z.discriminatedUnion("room", [
  z.object({ room: z.literal("cart"), sessionId: z.uuid() }),
  z.object({ room: z.literal("store"), storeId: z.string() }),
]);

type Ack = (res: { ok: true } | { ok: false; error: string }) => void;

/**
 * Socket.IO gateway. Clients authenticate in the handshake (auth.token, same bearer token as REST),
 * then ask to join a room:
 *   { room: "cart", sessionId }  - the shopper's own cart; replies with a cart.snapshot event
 *   { room: "store", storeId }   - staff only; store-wide events for the dashboard
 * Server -> client events are all emitted as "event" with the shared envelope.
 */
export class RealtimeServer {
  readonly io: Server;

  constructor(
    httpServer: HttpServer,
    private readonly deps: { prisma: PrismaClient; verifier: TokenVerifier; corsOrigins: string[]; redis?: Redis },
  ) {
    this.io = new Server(httpServer, { cors: { origin: deps.corsOrigins }, serveClient: false });
    if (deps.redis) {
      // Lets any API instance deliver to any room once there is more than one task.
      const pub = deps.redis.duplicate();
      const sub = deps.redis.duplicate();
      this.io.adapter(createAdapter(pub, sub));
    }

    this.io.use(async (socket, next) => {
      try {
        const token = (socket.handshake.auth as { token?: unknown }).token;
        if (typeof token !== "string") throw new AuthError("missing token");
        const identity = await deps.verifier.verify(token);
        socket.data.user = await upsertUser(deps.prisma, identity);
        next();
      } catch {
        next(new Error("unauthenticated"));
      }
    });
  }

  /** Wires the join handler. Separate from the constructor because it needs the cart service. */
  attach(carts: CartService) {
    this.io.on("connection", (socket) => {
      socket.on("join", async (raw: unknown, ack?: Ack) => {
        const reply: Ack = typeof ack === "function" ? ack : () => {};
        const parsed = JoinRequest.safeParse(raw);
        if (!parsed.success) return reply({ ok: false, error: "invalid_request" });
        const user = socket.data.user as AuthUser;
        try {
          if (parsed.data.room === "cart") {
            const { sessionId } = parsed.data;
            await carts.ownedSession(sessionId, user.id);
            await socket.join(rooms.cart(sessionId));
            reply({ ok: true });
            // A fresh snapshot on every join is how a reconnecting app resynchronises.
            const snapshot = await carts.snapshot(sessionId);
            socket.emit("event", {
              type: "cart.snapshot",
              eventId: crypto.randomUUID(),
              storeId: snapshot.storeId,
              cartId: snapshot.cartCode,
              source: "system",
              occurredAt: new Date().toISOString(),
              data: snapshot,
            } satisfies SmartCartEvent);
          } else {
            if (!(await isStaff(this.deps.prisma, user.id, parsed.data.storeId))) {
              return reply({ ok: false, error: "forbidden" });
            }
            await socket.join(rooms.store(parsed.data.storeId));
            reply({ ok: true });
          }
        } catch {
          reply({ ok: false, error: "not_found" });
        }
      });
    });
  }

  publish: Publish = (event, toRooms) => {
    this.io.to(toRooms).emit("event", event);
  };

  close() {
    return new Promise<void>((resolve) => this.io.close(() => resolve()));
  }
}
