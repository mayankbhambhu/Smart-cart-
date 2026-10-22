# Smart Cart

Checkout-free shopping for a DMart pilot: shoppers pair a cart with their phone, scan items as they
shop, see a live GST-inclusive total, pay in the app and walk out, or reserve items for pickup.
The same app has a staff mode for the store team on the floor (help requests, picking
reservations, tasks, stock counts, the exit check), and store managers run the store from a web
dashboard.

Two sides sign in differently. Shoppers use Google, Apple (on iPhone) or their phone number.
The store team signs in with a staff ID or registered phone and a password; those accounts exist
only after a store manager requests one and the SmartCart admin team approves it.

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

Opened in the same browser, the two talk to each other: the shopper's cart, payment, help requests
and reservations show up on the dashboard, staff answering a help request update the phone, an
account approved on the dashboard can sign in on the app's Store team tab, and an offer started on
the dashboard's Offers page reprices the app and shows up as an aisle deal alert. The dashboard's
**Shopper app** page shows the app in a phone frame beside it.

Demo accounts (both demos show them on the sign-in screen):

| Who | Staff ID | Password | Where |
| --- | --- | --- | --- |
| Floor staff, Rajesh Kumar | `S01-0002` | `floor-demo-1` | the app's Store team tab |
| Store manager, Anita Desai | `S01-0001` | `manager-demo-1` | dashboard (and the app) |
| SmartCart admin team | `ADM-0001` | `admin-demo-1` | dashboard: Account approvals |

Shoppers sign in with any name; the demo's phone OTP code is `123456`.

The `Demos on GitHub Pages` workflow publishes both on every push to main: the dashboard at
https://mayankbhambhu.github.io/Smart-cart-/ and the app at
https://mayankbhambhu.github.io/Smart-cart-/app/ (open that on a phone and add it to the home
screen). Pages must be set to **Settings → Pages → Source: GitHub Actions**.

## Sign-in during development

Shoppers: until the Firebase project exists, run the API with `AUTH_MODE=dev` (the default outside
production). It then accepts bearer tokens of the form `dev:<uid>` or `dev:<uid>:<display name>`
without checking them, and refuses to start that way when `ENV=production`. With
`AUTH_MODE=firebase` and `FIREBASE_PROJECT_ID` set, the API verifies real Firebase ID tokens
against Google's public keys.

Store team: `POST /v1/auth/staff/login` takes a staff ID or registered phone and a password and
returns a 12-hour session token signed with `SESSION_SECRET`. Five wrong passwords lock the account
for 15 minutes, and a temporary password must be changed at first sign-in. `GET /v1/me` tells
either app which side to show, from the account's role on the server. The seed creates a store
manager (`dev:staff-demo`, staff ID `S01-0001`) and the SmartCart admin team (`dev:admin-demo`,
`ADM-0001`) for dev tokens; `NEXT_PUBLIC_DEV_AUTH_TOKEN` signs the dashboard in as one of them. To
try a real password sign-in, request an account on **Staff accounts** as the manager, approve it on
**Account approvals** as `dev:admin-demo`, and sign in with the staff ID and the temporary password
the approval shows (`SMS_PROVIDER=log` returns the SMS text instead of sending it).

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

## Voice search and aisle deals

On the app's Find screen, tap the mic and say the item in English or Hindi ("haldi kahan milega",
"मुझे चीनी चाहिए", "where is the ghee"). The words around the item are dropped, Hindi item words
(typed in Latin letters or heard in Devanagari) map to the catalogue, and the top result's aisle,
shelf, stock and any offer are read aloud. Nothing found means saying so and pointing to floor
help, never a guess. Spoken searches are counted on the dashboard's Reports page.

- Phones use on-device recognition from `expo-speech-recognition`, which needs a development or
  store build (`npx expo run:android` / `run:ios`, or EAS). In Expo Go the mic reports that voice
  isn't available, and the keyboard's own mic still works.
- The web demo uses the browser's speech recognition (Chrome on Android, Safari on iPhone).
  Embedded previews may block the microphone; the "Try asking" examples still work there.

Store managers run offers on the dashboard's **Offers** page: a product, an offer price below its
regular price, and how long (at most 31 days; one offer per product at a time). While it runs the
offer price is the price in search, the cart, checkout and the receipt. When a shopper scans an
item, the app shows that aisle's deals once (respecting their diet preference, and leaving out
what's already in the cart); the **Deals** screen lists them all and turns the alerts off. Nothing
sets or changes an offer on its own. The seed starts eight week-long demo offers
(`data/offers.csv`).

## Tests

```sh
pnpm typecheck
pnpm test             # contracts, demo, mobile
pnpm test:api         # API (pytest); integration tests run when DATABASE_URL and REDIS_URL are set
pnpm --filter @smart-cart/mobile export:check   # Android and iOS bundles
```

## Demo data

`apps/api/src/smartcart/data/products.csv` holds 234 everyday products for one demo store (`S-01`)
with 20 carts (`C-0001` to `C-0020`). Fourteen start below their low-stock threshold so the
dashboard has alerts to show. Floor staff park a picked reservation in any free cart; the web
demos use `C-0016`, `C-0017`, `C-0018` and `C-0020` for that.

Products sit in 13 sections (Fruits, Vegetables, Dairy and eggs, Meat and fish, Staples, Spices and
masala, Bakery, Snacks and packaged food, Beverages, Frozen, Personal care, Household and cleaning,
Baby care), listed with their categories in `data/sections.json`. Each product carries the pack's
food label (`veg`, `non_veg`, `egg` or `not_food`) and any diet claims printed on it (`jain`,
`vegan`, `gluten_free`, `sugar_free`, `no_added_sugar`). A product without a label shows "not
labelled": labels are never guessed. Managers correct them on the dashboard's Inventory page.

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
5. **Two sides**: Shopper or Store team sign-in; store-team accounts requested by a manager and
   approved by the SmartCart admin team (switching one off too); reservations for a pickup slot;
   the app's staff mode (help inbox, pick list, tasks, stock check and correction, exit check);
   product sections with veg and non-veg labels and a diet preference; and the dashboard's
   Reservations, Staff and tasks, Reports, Staff accounts and Account approvals pages.
6. **Voice search and aisle deals**: search by voice in English or Hindi with the answer read
   aloud (US-02); managers' offers with aisle deal alerts and a Deals screen (US-08); spoken
   searches in Reports.
7. Pilot hardening: reconnects, idempotency, rate limits, Sentry, a 20-shopper usability test.

Deploying staging: [docs/deploy-staging.md](docs/deploy-staging.md).
