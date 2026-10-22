# Smart Cart shopper app (React Native + Expo)

One TypeScript codebase for Android and iPhone, built on Expo SDK 58 with Expo Router.
State lives in Zustand (session, live cart) and TanStack Query (store list). Shared event and API
types come from `packages/contracts`.

```
src/app/            screens (Expo Router: each file is a route)
  _layout.tsx       providers, sign-in guard, stack
  sign-in.tsx       test sign-in (Firebase later)
  index.tsx         home: pick a store, or resume an open cart
  pair.tsx          scan the cart's QR (or type the cart number)
  cart/index.tsx    live cart: lines, GST, running total, remove, leave
  cart/scan.tsx     barcode scanner with a confirm-before-add preview
src/components/     Button, ScannerView (expo-camera + typed fallback)
src/lib/            api client, realtime (Socket.IO), stores, money, QR parsing
scripts/smoke.ts    drives the API client and realtime code against a running API
```

## Run it on your phone

1. Start the API and seed it (see the root README). It must run with `AUTH_MODE=dev` for now.
2. `cp .env.example .env` and set `EXPO_PUBLIC_API_URL` to your laptop's LAN address,
   e.g. `http://192.168.1.20:4000`. The phone and laptop must be on the same Wi-Fi.
3. `pnpm --filter @smart-cart/mobile start` and scan the QR it prints with **Expo Go**
   (Android: the Expo Go app; iPhone: the Camera app). Expo Go must support SDK 58.
4. Sign in with any name, pick the store, and scan a cart QR. To make one, encode
   `smartcart://pair?cart=C-0001&store=S-01` in any QR generator, or type `C-0001`.
5. Scan items. The demo barcodes are synthetic (`2000000000015` is Amul Toned Milk 500 ml);
   print some from `apps/api/src/smartcart/data/products.csv` or type them in.

6. Tap **Checkout**, review the locked prices and GST, and tap **Pay**. With the API's default test
   payment no money moves; with Stripe test mode, pay with card `4242 4242 4242 4242`, any future
   date and any CVC. The receipt shows the exit QR and code.

Open the dashboard's **Active carts** and **Orders** pages alongside to watch the cart and the order
update live, and check the exit code on the Orders page.

## Checks

```sh
pnpm --filter @smart-cart/mobile typecheck
pnpm --filter @smart-cart/mobile test            # unit tests (jest-expo)
pnpm --filter @smart-cart/mobile export:check    # bundles for Android and iOS
EXPO_PUBLIC_API_URL=http://localhost:4000 pnpm --filter @smart-cart/mobile smoke
```

## Behaviour worth knowing

- A barcode held in view is reported once, not every frame: the same code is ignored for 3 s and
  scanning pauses while a product preview is open.
- Each add carries a `requestId` kept for that preview, so a retry after a dropped connection is
  applied once by the server.
- On every reconnect the app rejoins the cart room and the server sends a full snapshot.
- Prices and totals on screen always come from the server; the app never sums money.
