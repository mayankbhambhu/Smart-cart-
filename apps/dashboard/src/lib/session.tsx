"use client";

import type { MeResponse, StaffLoginResponse } from "@smart-cart/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { apiGet, apiPost, DEMO, DEV_AUTH_TOKEN, onSessionLost, sessionStore, setToken, type StaffSession } from "./api";

type SessionState = {
  /** False until the saved session has been read. */
  ready: boolean;
  session: StaffSession | null;
  signIn: (login: string, password: string) => Promise<StaffSession>;
  changePassword: (current: string, next: string) => Promise<void>;
  signOut: () => void;
};

const Session = createContext<SessionState | null>(null);
export const useSession = () => {
  const s = useContext(Session);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
};

/** Store-team sign-in for the dashboard. The account's role decides which pages it gets. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<StaffSession | null>(null);

  const use = useCallback(
    (s: StaffSession | null) => {
      setToken(s?.token ?? null);
      // The demo's accounts live in memory, so a demo sign-in ends with the tab.
      sessionStore.save(DEV_AUTH_TOKEN || DEMO ? null : s);
      setSession(s);
      queryClient.clear();
    },
    [queryClient],
  );

  useEffect(() => {
    onSessionLost(() => use(null));
    if (DEV_AUTH_TOKEN) {
      // Local development against AUTH_MODE=dev: the role comes from the API, as for a real sign-in.
      const token = DEV_AUTH_TOKEN;
      void apiGet<MeResponse>("/v1/me")
        .then((me) =>
          setSession(
            me.staff && {
              token,
              expiresAt: new Date(Date.now() + 864e5).toISOString(),
              name: me.staff.name ?? me.name ?? "Staff",
              staffCode: me.staff.staffCode ?? "",
              role: me.staff.role,
              storeId: me.staff.storeId,
              mustChangePassword: false,
            },
          ),
        )
        .catch(() => setSession(null))
        .finally(() => setReady(true));
      return;
    }
    const saved = DEMO ? null : sessionStore.load();
    setToken(saved?.token ?? null);
    setSession(saved);
    setReady(true);
  }, [use]);

  const signIn = async (login: string, password: string) => {
    const res = await apiPost<StaffLoginResponse>("/v1/auth/staff/login", { login: login.trim(), password });
    const s: StaffSession = {
      token: res.token,
      expiresAt: res.expiresAt,
      name: res.staff.name ?? res.staff.staffCode ?? "Staff",
      staffCode: res.staff.staffCode ?? "",
      role: res.staff.role,
      storeId: res.staff.storeId,
      mustChangePassword: res.mustChangePassword,
    };
    use(s);
    return s;
  };

  const changePassword = async (current: string, next: string) => {
    await apiPost("/v1/auth/staff/password", { currentPassword: current, newPassword: next });
    if (session) use({ ...session, mustChangePassword: false });
  };

  return (
    <Session.Provider value={{ ready, session, signIn, changePassword, signOut: () => use(null) }}>
      {children}
    </Session.Provider>
  );
}
