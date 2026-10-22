import * as Crypto from "expo-crypto";
import { create } from "zustand";
import { setAuthToken } from "./api";
import { storage } from "./storage";

export type Session = { uid: string; name: string };

/**
 * Dev-mode token understood by the API when it runs with AUTH_MODE=dev.
 * Replaced by a Firebase ID token once the Firebase project exists.
 */
export const tokenFor = (s: Session) => `dev:${s.uid}:${s.name}`;

const UID_KEY = "auth.uid";
const NAME_KEY = "auth.name";

type AuthState = {
  /** False until the saved session has been read from secure storage. */
  ready: boolean;
  session: Session | null;
  restore: () => Promise<void>;
  signIn: (name: string) => Promise<void>;
  signOut: () => Promise<void>;
};

/**
 * Test sign-in: a display name plus a random id kept on the device.
 * Firebase Authentication (email, Google, Apple, phone OTP) replaces this in a later milestone.
 */
export const useAuth = create<AuthState>((set) => ({
  ready: false,
  session: null,

  restore: async () => {
    const [uid, name] = await Promise.all([storage.get(UID_KEY), storage.get(NAME_KEY)]);
    const session = uid && name ? { uid, name } : null;
    setAuthToken(session ? tokenFor(session) : null);
    set({ ready: true, session });
  },

  signIn: async (rawName) => {
    const name = rawName.trim().replace(/\s+/g, " ").slice(0, 80);
    const uid = (await storage.get(UID_KEY)) ?? `u${Crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await storage.set(UID_KEY, uid);
    await storage.set(NAME_KEY, name);
    const session = { uid, name };
    setAuthToken(tokenFor(session));
    set({ session });
  },

  signOut: async () => {
    await storage.remove(NAME_KEY);
    setAuthToken(null);
    set({ session: null });
  },
}));
