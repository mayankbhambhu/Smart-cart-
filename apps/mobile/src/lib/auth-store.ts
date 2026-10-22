import type { StaffRole } from "@smart-cart/contracts";
import * as Crypto from "expo-crypto";
import { create } from "zustand";
import { ApiError, api, setAuthToken } from "./api";
import { storage } from "./storage";

export type ShopperMethod = "test" | "google" | "apple" | "phone";

export type Session =
  | { kind: "shopper"; uid: string; name: string; method: ShopperMethod }
  | {
      kind: "staff";
      /** API session token from staff sign-in, valid 12 hours. */
      token: string;
      expiresAt: string;
      name: string;
      staffCode: string;
      role: StaffRole;
      storeId: string;
      mustChangePassword: boolean;
    };

/**
 * The bearer token for the API. Shoppers use the dev-mode token the API accepts with AUTH_MODE=dev
 * until the Firebase project exists; store-team members use the token from staff sign-in.
 */
export const tokenFor = (s: Session) => (s.kind === "staff" ? s.token : `dev:${s.uid}:${s.name}`);

const SESSION_KEY = "auth.session";
/** Kept across sign-outs so a shopper's receipts stay theirs on this device. */
const UID_KEY = "auth.uid";
const LEGACY_NAME_KEY = "auth.name";

type AuthState = {
  /** False until the saved session has been read from secure storage. */
  ready: boolean;
  session: Session | null;
  restore: () => Promise<void>;
  signInShopper: (name: string, method?: ShopperMethod) => Promise<void>;
  /** Staff ID or registered phone, plus password. The server decides the side, not the login tab. */
  signInStaff: (login: string, password: string) => Promise<Session>;
  changePassword: (current: string, next: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const save = (session: Session | null) =>
  session ? storage.set(SESSION_KEY, JSON.stringify(session)) : storage.remove(SESSION_KEY);

export const useAuth = create<AuthState>((set, get) => {
  const use = async (session: Session | null) => {
    setAuthToken(session ? tokenFor(session) : null);
    set({ session });
    await save(session).catch(() => {});
  };

  return {
    ready: false,
    session: null,

    restore: async () => {
      let session: Session | null = null;
      try {
        const raw = await storage.get(SESSION_KEY);
        session = raw ? (JSON.parse(raw) as Session) : null;
        if (!session) {
          // Signed in before store-team accounts existed.
          const [uid, name] = await Promise.all([storage.get(UID_KEY), storage.get(LEGACY_NAME_KEY)]);
          if (uid && name) session = { kind: "shopper", uid, name, method: "test" };
        }
      } catch {
        session = null;
      }
      if (session?.kind === "staff" && Date.parse(session.expiresAt) <= Date.now()) session = null;
      setAuthToken(session ? tokenFor(session) : null);
      set({ ready: true, session });
      // A staff account can be suspended while the app is closed: check with the server.
      if (session?.kind === "staff") {
        api.me().catch((e) => {
          if (e instanceof ApiError && (e.status === 401 || e.code === "forbidden")) void get().signOut();
        });
      }
    },

    signInShopper: async (rawName, method = "test") => {
      const name = rawName.trim().replace(/\s+/g, " ").slice(0, 80);
      const uid = (await storage.get(UID_KEY)) ?? `u${Crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      await storage.set(UID_KEY, uid);
      await use({ kind: "shopper", uid, name, method });
    },

    signInStaff: async (login, password) => {
      const res = await api.staffLogin(login.trim(), password);
      const session: Session = {
        kind: "staff",
        token: res.token,
        expiresAt: res.expiresAt,
        name: res.staff.name ?? res.staff.staffCode ?? "Staff",
        staffCode: res.staff.staffCode ?? "",
        role: res.staff.role,
        storeId: res.staff.storeId,
        mustChangePassword: res.mustChangePassword,
      };
      await use(session);
      return session;
    },

    changePassword: async (current, next) => {
      const session = get().session;
      if (session?.kind !== "staff") return;
      await api.changePassword(current, next);
      await use({ ...session, mustChangePassword: false });
    },

    signOut: async () => {
      await use(null);
    },
  };
});
