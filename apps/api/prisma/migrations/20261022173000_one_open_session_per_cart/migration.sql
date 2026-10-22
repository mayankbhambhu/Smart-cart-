-- A physical cart can have at most one open session. Prisma cannot express a partial unique
-- index in schema.prisma, so it lives here; the cart service relies on it to reject a
-- concurrent second pairing.
CREATE UNIQUE INDEX "cart_sessions_one_open_per_cart"
  ON "cart_sessions" ("cart_id")
  WHERE "status" IN ('active', 'checking_out');

-- One open session per shopper, for the same reason.
CREATE UNIQUE INDEX "cart_sessions_one_open_per_user"
  ON "cart_sessions" ("user_id")
  WHERE "status" IN ('active', 'checking_out');
