/**
 * API base URL, read at build time from EXPO_PUBLIC_API_URL (see .env.example).
 * On a real phone use your laptop's LAN address, e.g. http://192.168.1.20:4000.
 * On the Android emulator the host machine is http://10.0.2.2:4000.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
export const DEFAULT_STORE_ID = "S-01";
/**
 * Demo build (EXPO_PUBLIC_DEMO=1): no server. A simulated store in the app answers every call,
 * so the app can be tried as a web page. Used for the GitHub Pages and preview builds only.
 */
export const DEMO = process.env.EXPO_PUBLIC_DEMO === "1";
/**
 * Google, Apple and phone sign-in for shoppers run through Firebase Authentication. Until the
 * Firebase project exists (EXPO_PUBLIC_FIREBASE_API_KEY unset), real builds offer test sign-in
 * instead, and the demo build simulates the three.
 */
export const FIREBASE_READY = Boolean(process.env.EXPO_PUBLIC_FIREBASE_API_KEY);
