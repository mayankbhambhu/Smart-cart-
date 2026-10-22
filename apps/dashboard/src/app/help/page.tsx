"use client";

import type { HelpRequest } from "@smart-cart/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiPost, helpQuery, STORE_ID } from "@/lib/api";

const topics: Record<HelpRequest["topic"], string> = {
  find_item: "Can't find an item",
  price: "Price question",
  stock: "Out of stock",
  other: "Something else",
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

function minutesSince(iso: string, now: number) {
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  return m === 0 ? "just now" : `${m} min ago`;
}

/** US-09: floor staff see who needs help and where, and mark it on their way / done. */
export default function HelpPage() {
  const queryClient = useQueryClient();
  const open = useQuery(helpQuery(true));
  const today = useQuery(helpQuery(false));
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const act = async (id: string, action: "acknowledge" | "resolve") => {
    setBusy(id);
    try {
      await apiPost(`/admin/v1/stores/${STORE_ID}/help/${id}`, { action });
      await queryClient.invalidateQueries({ queryKey: ["help", STORE_ID] });
    } finally {
      setBusy(null);
    }
  };

  const requests = open.data ?? [];
  const done = (today.data ?? []).filter((h) => h.status === "resolved" || h.status === "cancelled");

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Help requests</h1>
        <p className="text-sm text-slate-500">
          Shoppers tap Call for help in the app. The aisle is where they scanned their last item.
        </p>
      </div>

      {open.error ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">Could not reach the API: {(open.error as Error).message}</p>
      ) : open.isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : requests.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          Nobody is waiting. New requests appear here the moment a shopper asks.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {requests.map((h) => (
            <li
              key={h.id}
              className={`space-y-3 rounded-lg border bg-white p-4 ${h.status === "open" ? "border-orange-300" : "border-slate-200"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{h.aisle ? `Aisle ${h.aisle}` : "Aisle unknown"}</p>
                  <p className="text-sm text-slate-600">
                    {h.shopperName ?? "Shopper"}
                    {h.cartId && <> · cart {h.cartId}</>} · {minutesSince(h.createdAt, now)}
                  </p>
                </div>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    h.status === "open" ? "bg-orange-100 text-orange-900" : "bg-brand-soft text-brand"
                  }`}
                >
                  {h.status === "open" ? "Waiting" : "On the way"}
                </span>
              </div>
              <p className="text-sm">
                <span className="font-medium">{topics[h.topic]}</span>
                {h.note && <span className="text-slate-600"> · “{h.note}”</span>}
              </p>
              <div className="flex gap-2">
                {h.status === "open" && (
                  <button
                    disabled={busy === h.id}
                    onClick={() => void act(h.id, "acknowledge")}
                    className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    I'm on my way
                  </button>
                )}
                <button
                  disabled={busy === h.id}
                  onClick={() => void act(h.id, "resolve")}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
                >
                  Resolved
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">Earlier today</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Asked</th>
                  <th className="px-3 py-2">Aisle</th>
                  <th className="px-3 py-2">Topic</th>
                  <th className="px-3 py-2">Note</th>
                  <th className="px-3 py-2">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {done.map((h) => (
                  <tr key={h.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 tabular-nums text-slate-600">{time(h.createdAt)}</td>
                    <td className="px-3 py-2">{h.aisle ?? "—"}</td>
                    <td className="px-3 py-2">{topics[h.topic]}</td>
                    <td className="px-3 py-2 text-slate-600">{h.note ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {h.status === "cancelled" ? "Cancelled by shopper" : `Resolved ${h.resolvedAt ? time(h.resolvedAt) : ""}`}
                    </td>
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
