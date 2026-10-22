/**
 * API base URL, read at build time from EXPO_PUBLIC_API_URL (see .env.example).
 * On a real phone use your laptop's LAN address, e.g. http://192.168.1.20:4000.
 * On the Android emulator the host machine is http://10.0.2.2:4000.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
export const DEFAULT_STORE_ID = "S-01";
