# Smart Cart shopper app (Flutter)

One codebase for Android and iPhone. Feature-first folders: `lib/features/<feature>/{data,domain,ui}`,
Riverpod for state, go_router for navigation, Dio for HTTP.

## Run

```sh
flutter pub get
# Android emulator talking to the API on your laptop:
flutter run --dart-define=API_URL=http://10.0.2.2:4000
# Real phone on the same Wi-Fi (use your laptop's LAN IP):
flutter run --dart-define=API_URL=http://192.168.1.20:4000
```

iPhone builds need Xcode on a Mac and an Apple developer account for installing on a device.

## Test

```sh
flutter analyze
flutter test
```

## What is in milestone 1

- Home: lists stores from `GET /v1/stores`.
- Look up product: manual barcode entry against `GET /v1/products/barcode/:code`
  (try `2000000000015`, Amul Toned Milk 500 ml from the demo seed).
- Pair cart: placeholder. The camera scanner, sign-in and the live cart arrive in milestone 2.
