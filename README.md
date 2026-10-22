# Smart Cart

Checkout-free shopping for a DMart pilot: shoppers pair a cart with their phone, scan items as they
shop, see a live GST-inclusive total, pay in the app and walk out. Store staff watch inventory,
carts and orders on a web dashboard.

Architecture: [docs/architecture.md](docs/architecture.md).

## Repo layout

```
apps/
  api/          Python 3.12: FastAPI, SQLAlchemy + Alembic (PostgreSQL), Redis, python-socketio
  dashboard/    Next.js 15 + Tailwind: store staff dashboard
  mobile/       React Native (Expo) app for Android and iPhone
packages/
  contracts/    Shared event and API schemas (zod), exported as JSON Schema; the API is tested against them
  demo/         In-browser stand-in for the API, used by the dashboard and app web demos
infra/
  docker-compose.yml     Local Postgres, Redis, API and dashboard
  terraform/staging/     AWS ap-south-1 staging stack (not applied by CI)
docs/
```

## Run it locally

Needs Node 22, pnpm 10, [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 for you) and Docker. The mobile app runs in Expo Go on your phone.

```sh
pnpm install
(cd apps/api && uv sync)
docker compose -f infra/docker-compose.yml up -d postgres redis
cp apps/api/.env.example apps/api/.env
pnpm --filter "./packages/*" build
pnpm db:migrate
pnpm db:seed
pnpm dev:api          # http://localhost:4000/readyz
pnpm dev:dashboard    # http://localhost:3000
```

Or run the whole stack in containers: `docker compose -f infra/docker-compose.yml up --build`.

Mobile: see [apps/mobile/README.md](apps/mobile/README.md).

## Web demos (GitHub Pages)

Both demos run entirely in the browser on the sample catalogue, with no API, so they can be clicked
through anywhere:

- `pnpm --filter @smart-cart/dashboard build:demo` builds the staff dashboard with simulated
  shoppers.
- `pnpm --filter @smart-cart/mobile build:web-demo` builds the shopper app for the web
  (`EXPO_PUBLIC_DEMO=1`): tap a cart and products instead of scanning, and pay with the test payment.

Opened in the same browser, the two talk to each other: the shopper's cart, payment and help
requests show up on the dashboard, and staff answering a help request update the phone. The
dashboard's **Shopper app** page shows the app in a phone frame beside it.

The `Demos on GitHub Pages` workflow publishes both on every push to main: the dashboard at
https://mayankbhambhu.github.io/Smart-cart-/ and the app at
https://mayankbhambhu.github.io/Smart-cart-/app/ (open that on a phone and add it to the home
screen). Pages must be set to **Settings → Pages → Source: GitHub Actions**.

## Sign-in during development

Until the Firebase project exists, run the API with `AUTH_MODE=dev` (the default outside
production). It then accepts bearer tokens of the form `dev:<uid>` or `dev:<uid>:<display name>`
without checking them, and refuses to start that way when `ENV=production`. The seed creates a
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

Open http://localhost:3000/carts to watch the cart appear and its total update live. Then pay:

```sh
curl -s -X POST localhost:4000/v1/carts/<sessionId>/checkout -H "$T"     # returns the orderId
curl -s -X POST localhost:4000/v1/orders/<orderId>/pay/fake -H "$T"      # receipt with exitCode
```

The order shows up on http://localhost:3000/orders, where the exit check accepts the code once.

## Payments

The API talks to payment providers through one `PaymentProvider` interface
(`apps/api/src/smartcart/payments.py`). With `PAYMENT_PROVIDER=fake` (the default outside
production) orders are paid by a test call and no money moves, so the whole flow can be demoed
without a Stripe account. With `PAYMENT_PROVIDER=stripe` the app opens Stripe's PaymentSheet and the
order is marked paid only when Stripe's signed webhook says so. To try Stripe test mode locally, put
your test keys in `apps/api/.env` and forward webhooks with the Stripe CLI:
`stripe listen --forward-to localhost:4000/v1/payments/stripe/webhook`.

## Ask SmartCart

The in-app assistant looks the question up in the store's catalogue and stock first, then asks
Claude to answer from only those facts: it must not invent a location, price or stock level, and it
cannot buy, price or reserve anything. Set `ANTHROPIC_API_KEY` in `apps/api/.env` to turn Claude on;
without it the same facts are turned into a plain answer by rules, which is also what the web demo
uses.

## Tests

```sh
pnpm typecheck
pnpm test             # contracts, demo, mobile
pnpm test:api         # API (pytest); integration tests run when DATABASE_URL and REDIS_URL are set
pnpm --filter @smart-cart/mobile export:check   # Android and iOS bundles
```

## Demo data

`apps/api/src/smartcart/data/products.csv` holds 213 everyday products across 11 categories for one demo
store (`S-01`) with 20 carts (`C-0001` to `C-0020`). Fourteen start below their low-stock threshold
so the dashboard has alerts to show.

The barcodes are **synthetic**: they use the GS1 in-store prefix `20`, so they can never clash with
a real product, but scanning a real pack will not find it. Print the codes, or replace the
`barcode` column with codes read off real packs. GST rates and HSN codes are illustrative and must
be checked before the pilot.

## V1 milestones

1. **Skeleton**: monorepo, schema, seed, API health and catalogue lookup, inventory
   dashboard, Flutter shell, Terraform for staging, CI.
2. **Scan to cart**: sign-in, pair by QR, camera scanning, live cart over WebSocket, live
   Active carts page. The shopper app is React Native (Expo).
3. **Pay and leave**: checkout, Stripe test-mode payment (or the built-in test payment), webhook,
   e-receipt with GST summary, one-time exit QR, and the dashboard's Orders page and exit check.
4. **Find it fast**: product search with aisle, shelf, stock and unit price; a smart list that
   becomes a walking route; Ask SmartCart; call for help with staff alerts; a budget tracker; and
   store insights (missed searches, help by aisle). Plus the shopper app's web demo.
5. Pilot hardening: reconnects, idempotency, rate limits, Sentry, a 20-shopper usability test.

Deploying staging: [docs/deploy-staging.md](docs/deploy-staging.md).
