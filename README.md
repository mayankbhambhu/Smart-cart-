# Smart Cart

Checkout-free shopping for a DMart pilot: shoppers pair a cart with their phone, scan items as they
shop, see a live GST-inclusive total, pay in the app and walk out. Store staff watch inventory,
carts and orders on a web dashboard.

Architecture: [docs/architecture.md](docs/architecture.md).

## Repo layout

```
apps/
  api/          Node 22 + TypeScript, Fastify, Prisma (PostgreSQL), Redis
  dashboard/    Next.js 15 + Tailwind: store staff dashboard
  mobile/       Flutter app for Android and iPhone
packages/
  contracts/    Shared event and API schemas (zod), exported as JSON Schema for Dart
infra/
  docker-compose.yml     Local Postgres, Redis, API and dashboard
  terraform/staging/     AWS ap-south-1 staging stack (not applied by CI)
docs/
```

## Run it locally

Needs Node 22, pnpm 10 and Docker. Flutter 3.x for the mobile app.

```sh
pnpm install
docker compose -f infra/docker-compose.yml up -d postgres redis
cp apps/api/.env.example apps/api/.env
pnpm --filter @smart-cart/contracts build
pnpm --filter @smart-cart/api db:generate
pnpm --filter @smart-cart/api exec prisma migrate deploy
pnpm db:seed
pnpm dev:api          # http://localhost:4000/readyz
pnpm dev:dashboard    # http://localhost:3000
```

Or run the whole stack in containers: `docker compose -f infra/docker-compose.yml up --build`.

Mobile: see [apps/mobile/README.md](apps/mobile/README.md).

## Sign-in during development

Until the Firebase project exists, run the API with `AUTH_MODE=dev` (the default outside
production). It then accepts bearer tokens of the form `dev:<uid>` or `dev:<uid>:<display name>`
without checking them, and refuses to start that way when `NODE_ENV=production`. The seed creates a
demo store manager, `dev:staff-demo`, which the dashboard uses. With `AUTH_MODE=firebase` and
`FIREBASE_PROJECT_ID` set, the API verifies real Firebase ID tokens against Google's public keys.

## Try the cart from a terminal

```sh
T="Authorization: Bearer dev:asha:Asha"
curl -s -X POST localhost:4000/v1/carts/pair -H "$T" -H 'content-type: application/json' \
  -d '{"cartCode":"C-0001","storeId":"S-01"}'            # returns the sessionId
curl -s -X POST localhost:4000/v1/carts/<sessionId>/items -H "$T" -H 'content-type: application/json' \
  -d "{\"barcode\":\"2000000000015\",\"qty\":2,\"requestId\":\"$(uuidgen)\"}"
```

Open http://localhost:3000/carts to watch the cart appear and its total update live.

## Tests

```sh
pnpm typecheck
pnpm test             # API integration tests run when DATABASE_URL and REDIS_URL are set
cd apps/mobile && flutter analyze && flutter test
```

## Demo data

`apps/api/prisma/data/products.csv` holds 213 everyday products across 11 categories for one demo
store (`S-01`) with 20 carts (`C-0001` to `C-0020`). Fourteen start below their low-stock threshold
so the dashboard has alerts to show.

The barcodes are **synthetic**: they use the GS1 in-store prefix `20`, so they can never clash with
a real product, but scanning a real pack will not find it. Print the codes, or replace the
`barcode` column with codes read off real packs. GST rates and HSN codes are illustrative and must
be checked before the pilot. Regenerate the file with `pnpm --filter @smart-cart/api seed:generate-catalog`.

## V1 milestones

1. **Skeleton** (this): monorepo, schema, seed, API health and catalogue lookup, inventory
   dashboard, Flutter shell, Terraform for staging, CI.
2. Scan to cart: sign-in, pair by QR, camera scanning, live cart over WebSocket.
   The API and dashboard side is done; the shopper app is moving from Flutter to React.
3. Pay and leave: Stripe test-mode checkout, webhook, e-receipt and exit QR.
4. Store view: live dashboard pages for carts and orders, low-stock alerts.
5. Pilot hardening: reconnects, idempotency, rate limits, Sentry, a 20-shopper usability test.

Deploying staging: [docs/deploy-staging.md](docs/deploy-staging.md).
