import type { PrismaClient } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { AuthError, type TokenVerifier, type VerifiedIdentity } from "./verifier.js";

export type AuthUser = { id: string; firebaseUid: string; name: string | null };

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireStaff: (req: FastifyRequest<{ Params: { storeId: string } }>, reply: FastifyReply) => Promise<void>;
  }
}

/** Finds or creates the users row for a verified identity. */
export async function upsertUser(prisma: PrismaClient, identity: VerifiedIdentity): Promise<AuthUser> {
  const user = await prisma.user.upsert({
    where: { firebaseUid: identity.uid },
    update: {
      ...(identity.name ? { name: identity.name } : {}),
      ...(identity.email ? { email: identity.email } : {}),
      ...(identity.phone ? { phone: identity.phone } : {}),
    },
    create: {
      firebaseUid: identity.uid,
      name: identity.name ?? null,
      email: identity.email ?? null,
      phone: identity.phone ?? null,
    },
  });
  return { id: user.id, firebaseUid: user.firebaseUid, name: user.name };
}

export function bearerToken(header: string | undefined): string | null {
  const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
  return match ? match[1]!.trim() : null;
}

export async function isStaff(prisma: PrismaClient, userId: string, storeId: string): Promise<boolean> {
  const row = await prisma.staff.findUnique({ where: { userId_storeId: { userId, storeId } } });
  return row !== null;
}

export const authPlugin = fp<{ verifier: TokenVerifier }>(async (app, { verifier }) => {
  app.decorateRequest("user", null);

  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    const token = bearerToken(req.headers.authorization);
    if (!token) return reply.code(401).send({ error: "unauthenticated" });
    try {
      const identity = await verifier.verify(token);
      req.user = await upsertUser(app.deps.prisma, identity);
    } catch (err) {
      if (err instanceof AuthError) return reply.code(401).send({ error: "unauthenticated" });
      throw err;
    }
  });

  /** Must run after authenticate. Checks the user is staff at the route's :storeId. */
  app.decorate(
    "requireStaff",
    async (req: FastifyRequest<{ Params: { storeId: string } }>, reply: FastifyReply) => {
      if (!req.user || !(await isStaff(app.deps.prisma, req.user.id, req.params.storeId))) {
        return reply.code(403).send({ error: "forbidden" });
      }
    },
  );
});
