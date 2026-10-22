"use client";

import type { ReactNode } from "react";
import { HelpAlerts } from "@/components/HelpAlerts";
import { LiveStatus } from "@/components/LiveStatus";
import { LowStockAlerts } from "@/components/LowStockAlerts";
import { Nav } from "@/components/Nav";
import { Centered } from "@/components/Centered";
import { ChangePassword, SignIn } from "@/components/SignIn";
import { STORE_ID } from "@/lib/api";
import { useSession } from "@/lib/session";
import { roleLabel } from "@/lib/team";

/** The signed-in frame. Who sees what is the account's role on the server, not a choice made here. */
export function Shell({ children }: { children: ReactNode }) {
  const { ready, session, signOut } = useSession();

  if (!ready) return <p className="p-6 text-sm text-slate-500">Loading…</p>;
  if (!session) return <SignIn />;
  if (session.mustChangePassword) return <ChangePassword />;
  if (session.role === "floor_staff") {
    return (
      <Centered>
        <h1 className="text-lg font-semibold">Use staff mode on the handheld</h1>
        <p className="text-sm text-slate-600">
          {session.name}, floor staff work from the SmartCart app on the store handheld: help requests, the pick list,
          tasks and stock checks. The dashboard is for store managers.
        </p>
        <button onClick={signOut} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
          Sign out
        </button>
      </Centered>
    );
  }

  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-brand">Smart Cart</span>
            <span className="text-sm text-slate-500">Store {STORE_ID}</span>
            <LiveStatus />
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-right leading-tight">
              <span className="block font-medium">{session.name}</span>
              <span className="block text-xs text-slate-500">
                {roleLabel[session.role]}
                {session.staffCode && ` · ${session.staffCode}`}
              </span>
            </span>
            <button onClick={signOut} className="rounded-md border border-slate-300 px-2.5 py-1 hover:bg-slate-50">
              Sign out
            </button>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-2">
          <Nav role={session.role} />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <HelpAlerts />
        <LowStockAlerts />
        {children}
      </main>
    </>
  );
}
