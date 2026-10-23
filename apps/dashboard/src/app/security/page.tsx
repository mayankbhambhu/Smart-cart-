"use client";

import type { SecurityAlert } from "@smart-cart/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiPost, STORE_ID } from "@/lib/api";
import { securityQuery } from "@/lib/queries";
import { ago, alertAdvice, alertTitle, statusLabel } from "@/lib/security";

type Action = "acknowledge" | "resolve" | "false_alarm";
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

/**
 * Anti-theft (V3): carts whose basket weighs more than what was scanned, and carts at the exit gate
 * without paying. The shopper is nudged in the app first; staff see it only if it lasts. Staff decide.
 */
export default function SecurityPage() {
  const queryClient = useQueryClient();
  const open = useQuery(securityQuery(true));
  const today = useQuery(securityQuery(false));
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const act = async (a: SecurityAlert, action: Action) => {
    setBusy(a.id);
    setFailed(null);
    try {
      await apiPost(`/admin/v1/stores/${STORE_ID}/security-alerts/${a.id}`, { action, note: notes[a.id]?.trim() || null });
      await queryClient.invalidateQueries({ queryKey: ["security", STORE_ID] });
      void queryClient.invalidateQueries({ queryKey: ["fleet", STORE_ID] });
    } catch {
      setFailed(a.id);
    } finally {
      setBusy(null);
    }
  };

  const alerts = open.data ?? [];
  const day = today.data ?? [];
  const closed = day.filter((a) => a.status !== "open" && a.status !== "acknowledged");
  const count = (s: SecurityAlert["status"]) => day.filter((a) => a.status === s).length;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Security</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Each cart weighs its basket and compares it with what was scanned. The shopper is asked in the app first; a
          cart shows here only if it still doesn't match after 45 seconds, or rolls through the exit gate unpaid. These
          are checks, not accusations: you decide what happened.
        </p>
      </div>

      {day.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Alerts today", day.length],
            ["Cleared by the shopper", count("cleared")],
            ["Checked by staff", count("resolved")],
            ["False alarms", count("false_alarm")],
          ].map(([label, n]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-white p-3">
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{n}</dd>
            </div>
          ))}
        </dl>
      )}

      {open.error ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">Could not reach the API: {(open.error as Error).message}</p>
      ) : open.isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : alerts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          No carts need a check. New alerts appear here the moment a cart raises one.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {alerts.map((a) => (
            <li
              key={a.id}
              className={`space-y-3 rounded-lg border bg-white p-4 ${a.status === "open" ? "border-red-300" : "border-slate-200"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{alertTitle(a)}</p>
                  <p className="text-sm text-slate-600">
                    {a.shopperName ?? "Shopper"}
                    {a.aisle && a.aisle !== "EXIT" && <> · aisle {a.aisle}</>} · {ago(a.createdAt, now)}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${
                    a.status === "open" ? "bg-red-100 text-red-900" : "bg-brand-soft text-brand"
                  }`}
                >
                  {a.status === "acknowledged" && a.handledBy ? `${a.handledBy} is on it` : statusLabel[a.status]}
                </span>
              </div>
              <p className="text-sm text-slate-700">{alertAdvice(a)}</p>
              {a.kind === "unscanned_item" && (
                <p className="text-xs tabular-nums text-slate-500">
                  Scanned items {a.details.expectedG} g · basket {a.details.measuredG} g
                </p>
              )}
              <input
                value={notes[a.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                maxLength={200}
                placeholder="Note (optional): what you found"
                aria-label={`Note for cart ${a.cartId}`}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                {a.status === "open" && (
                  <button
                    disabled={busy === a.id}
                    onClick={() => void act(a, "acknowledge")}
                    className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    I'm on it
                  </button>
                )}
                <button
                  disabled={busy === a.id}
                  onClick={() => void act(a, "resolve")}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
                >
                  Checked
                </button>
                <button
                  disabled={busy === a.id}
                  onClick={() => void act(a, "false_alarm")}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
                >
                  False alarm
                </button>
              </div>
              {failed === a.id && <p className="text-sm text-red-700">Could not update it. It may already be closed.</p>}
            </li>
          ))}
        </ul>
      )}

      {closed.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">Earlier today</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Raised</th>
                  <th className="px-3 py-2">Cart</th>
                  <th className="px-3 py-2">What</th>
                  <th className="px-3 py-2">Outcome</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 tabular-nums text-slate-600">{time(a.createdAt)}</td>
                    <td className="px-3 py-2 font-mono">{a.cartId}</td>
                    <td className="px-3 py-2">{a.kind === "exit_unpaid" ? "At the exit unpaid" : "Unscanned weight"}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {statusLabel[a.status]}
                      {a.handledBy && ` · ${a.handledBy}`}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{a.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
