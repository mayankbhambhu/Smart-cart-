"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiGet, formatInr, STORE_ID, type ActiveCart } from "@/lib/api";

function minutesSince(iso: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

export default function CartsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["carts", STORE_ID],
    queryFn: () => apiGet<{ sessions: ActiveCart[] }>(`/admin/v1/stores/${STORE_ID}/carts`),
  });

  // Re-render each minute so "minutes in store" stays current.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const sessions = data?.sessions ?? [];
  const basketTotal = sessions.reduce((s, c) => s + c.totals.totalPaise, 0);

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Active carts</h1>
        <p className="text-sm text-slate-500">
          {sessions.length} {sessions.length === 1 ? "cart" : "carts"} in use · {formatInr(basketTotal)} in baskets
        </p>
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          Could not reach the API: {(error as Error).message}
        </p>
      ) : isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : sessions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          No carts in use. A cart appears here as soon as a shopper pairs it.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Cart</th>
                <th className="px-3 py-2">Shopper</th>
                <th className="px-3 py-2 text-right">Items</th>
                <th className="px-3 py-2 text-right">Running total</th>
                <th className="px-3 py-2 text-right">In store</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((c) => (
                <tr key={c.sessionId} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{c.cartCode}</td>
                  <td className="px-3 py-2">{c.shopperName ?? "Shopper"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.totals.itemCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInr(c.totals.totalPaise)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{minutesSince(c.startedAt, now)} min</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        c.status === "active" ? "bg-brand-soft text-brand" : "bg-sky-100 text-sky-800"
                      }`}
                    >
                      {c.status === "active" ? "Shopping" : "Checking out"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
