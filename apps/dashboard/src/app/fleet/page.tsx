"use client";

import type { FleetCart } from "@smart-cart/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiPost, STORE_ID } from "@/lib/api";
import { fleetQuery } from "@/lib/queries";
import { ago, faultLabel } from "@/lib/security";

type Filter = "all" | "attention" | "in_use" | "available" | "maintenance";
const filters: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs attention" },
  { key: "in_use", label: "In use" },
  { key: "available", label: "Free" },
  { key: "maintenance", label: "Out of service" },
];

const needsAttention = (c: FleetCart) => c.faults.length > 0 || c.openAlerts > 0;
const statusText: Record<FleetCart["status"], string> = { in_use: "In use", available: "Free", maintenance: "Out of service" };
const statusStyle: Record<FleetCart["status"], string> = {
  in_use: "bg-brand-soft text-brand",
  available: "bg-slate-100 text-slate-700",
  maintenance: "bg-amber-100 text-amber-900",
};
const weightText = { ok: "Weight matches scans", extra: "Heavier than scans", missing: "Lighter than scans", unknown: "Weight not checked" };

/** Every cart on the floor: who has it, battery, where it is, faults, and taking one out of service. */
export default function FleetPage() {
  const queryClient = useQueryClient();
  // Battery and last-seen change without an event, so the page also refreshes on its own.
  const { data, isLoading, error } = useQuery({ ...fleetQuery(), refetchInterval: 10_000 });
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const carts = data ?? [];
  const shown = carts.filter((c) => (filter === "all" ? true : filter === "attention" ? needsAttention(c) : c.status === filter));
  const tiles: [string, number, Filter][] = [
    ["In use", carts.filter((c) => c.status === "in_use").length, "in_use"],
    ["Free", carts.filter((c) => c.status === "available").length, "available"],
    ["Needs attention", carts.filter(needsAttention).length, "attention"],
    ["Out of service", carts.filter((c) => c.status === "maintenance").length, "maintenance"],
  ];

  const setStatus = async (c: FleetCart, status: "available" | "maintenance") => {
    setBusy(c.cartId);
    setFailed(null);
    try {
      const reason = status === "maintenance" ? c.faults.map((f) => faultLabel[f]).join(", ") || null : null;
      await apiPost(`/admin/v1/stores/${STORE_ID}/carts/${c.cartId}/status`, { status, reason });
      await queryClient.invalidateQueries({ queryKey: ["fleet", STORE_ID] });
    } catch {
      setFailed(c.cartId);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Cart fleet</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Every cart reports its battery, the aisle beacon it last heard and what its basket weighs, every few seconds.
          Take a cart out of service while it's being charged or repaired; shoppers can't pair it until it's back.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(([label, n, key]) => (
          <button
            key={label}
            onClick={() => setFilter(filter === key ? "all" : key)}
            className={`rounded-lg border bg-white p-3 text-left ${filter === key ? "border-brand ring-1 ring-brand" : "border-slate-200"}`}
          >
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{n}</dd>
          </button>
        ))}
      </dl>

      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Show carts">
        {filters.map((f) => (
          <button
            key={f.key}
            role="radio"
            aria-checked={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-sm ${
              filter === f.key ? "border-brand bg-brand text-white" : "border-slate-300 bg-white text-slate-700"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">Could not reach the API: {(error as Error).message}</p>
      ) : isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No carts here.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => (
            <li
              key={c.cartId}
              className={`space-y-3 rounded-lg border bg-white p-4 ${needsAttention(c) ? "border-amber-300" : "border-slate-200"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-lg font-semibold">{c.cartId}</p>
                  <p className="text-sm text-slate-600">
                    {c.status === "in_use"
                      ? `${c.shopperName ?? "Shopper"}${c.aisle ? ` · aisle ${c.aisle}` : ""}`
                      : c.status === "maintenance"
                        ? "Not available to shoppers"
                        : "Ready at the entrance"}
                  </p>
                </div>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${statusStyle[c.status]}`}>
                  {statusText[c.status]}
                </span>
              </div>

              <Battery pct={c.batteryPct} />

              {c.faults.length > 0 && (
                <ul className="flex flex-wrap gap-1">
                  {c.faults.map((f) => (
                    <li key={f} className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                      ⚠ {faultLabel[f]}
                    </li>
                  ))}
                </ul>
              )}

              <p className="text-xs text-slate-500">
                {c.seenAt ? `Checked in ${ago(c.seenAt, now)}` : "Never checked in"}
                {c.weightCheck && <> · {weightText[c.weightCheck]}</>}
              </p>
              {c.openAlerts > 0 && (
                <Link href="/security" className="block text-sm font-medium text-red-700 underline">
                  {c.openAlerts === 1 ? "1 open security alert" : `${c.openAlerts} open security alerts`}
                </Link>
              )}

              {c.status === "maintenance" ? (
                <button
                  disabled={busy === c.cartId}
                  onClick={() => void setStatus(c, "available")}
                  className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  Back in service
                </button>
              ) : c.status === "available" ? (
                <button
                  disabled={busy === c.cartId}
                  onClick={() => void setStatus(c, "maintenance")}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
                >
                  Take out of service
                </button>
              ) : null}
              {failed === c.cartId && <p className="text-sm text-red-700">Could not change it. A shopper may have just paired it.</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Battery level as a short meter with its number; low is called out in words, not only colour. */
function Battery({ pct }: { pct: number | null }) {
  if (pct === null) return <p className="text-xs text-slate-500">Battery unknown</p>;
  const low = pct < 20;
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Battery"
      >
        <div className={`h-full rounded-full ${low ? "bg-red-500" : pct < 50 ? "bg-amber-400" : "bg-brand"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`w-20 text-right text-xs tabular-nums ${low ? "font-semibold text-red-700" : "text-slate-600"}`}>
        {pct}%{low && " · charge"}
      </span>
    </div>
  );
}
