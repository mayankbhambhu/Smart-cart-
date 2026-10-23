"use client";

import type { StockCorrection, StoreInsights } from "@smart-cart/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, STORE_ID } from "@/lib/api";
import { correctionsQuery } from "@/lib/queries";
import { dateTime } from "@/lib/team";

const topicNames: Record<string, string> = {
  find_item: "Can't find an item",
  price: "Price question",
  stock: "Out of stock",
  other: "Something else",
};

/**
 * Reports: what shoppers looked for and didn't find (US-10), how floor help is going, and the stock
 * corrections floor staff made after counting a shelf.
 */
export default function ReportsPage() {
  const [days, setDays] = useState(7);
  const { data, isLoading, error } = useQuery({
    queryKey: ["insights", STORE_ID, days],
    queryFn: () => apiGet<StoreInsights>(`/admin/v1/stores/${STORE_ID}/insights?days=${days}`),
  });
  const corrections = useQuery(correctionsQuery(days));

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Reports</h1>
          <p className="text-sm text-slate-500">
            From searches, smart lists and Ask SmartCart in the app, floor help, and shelf counts. Use it to decide what to stock and where to put signs.
          </p>
        </div>
        <div className="flex gap-1 rounded-md border border-slate-200 bg-white p-0.5 text-sm" role="group" aria-label="Period">
          {[1, 7, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              className={`rounded px-2.5 py-1 ${days === d ? "bg-brand-soft font-medium text-brand" : "text-slate-600"}`}
            >
              {d === 1 ? "Today" : `${d} days`}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">Could not reach the API: {(error as Error).message}</p>
      ) : isLoading || !data ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Searches" value={data.searches.toLocaleString("en-IN")} note={`${data.voiceSearches} spoken into the mic`} />
            <Tile
              label="Found nothing"
              value={data.searches ? `${Math.round((data.missedSearches / data.searches) * 100)}%` : "—"}
              note={`${data.missedSearches} searches`}
            />
            <Tile label="Help requests" value={String(data.help.total)} note={`${data.help.open} open now`} />
            <Tile
              label="Time to reach shopper"
              value={data.help.avgMinutesToAcknowledge === null ? "—" : `${data.help.avgMinutesToAcknowledge} min`}
              note="average, to “on my way”"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Bars
              title="Searched for, not in the store"
              hint="Candidates to stock, or to point to a substitute."
              rows={data.topMissed.map((m) => ({ label: m.query, value: m.count }))}
              empty="Every search found something."
            />
            <div className="space-y-4">
              <Bars
                title="Help requests by aisle"
                hint="Aisles where shoppers get stuck. Check signage and shelf labels."
                rows={Object.entries(data.help.byAisle).map(([aisle, n]) => ({ label: `Aisle ${aisle}`, value: n }))}
                empty="No help requests in this period."
              />
              <Bars
                title="Help requests by reason"
                rows={Object.entries(data.help.byTopic).map(([t, n]) => ({ label: topicNames[t] ?? t, value: n }))}
                empty="No help requests in this period."
              />
            </div>
          </div>
          <Corrections rows={corrections.data} error={corrections.error} />
          <p className="text-xs text-slate-500">
            Expected impact isn't measured here. The pilot should compare these numbers before and after changes.
          </p>
        </>
      )}
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="text-xs text-slate-500">{note}</p>}
    </div>
  );
}

/** A single-series horizontal bar list: one hue, values as text, hover shows the exact count. */
function Bars({ title, hint, rows, empty }: { title: string; hint?: string; rows: { label: string; value: number }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {rows.map((r) => (
            <li key={r.label} className="group grid grid-cols-[8rem_1fr_2.5rem] items-center gap-2 text-sm" title={`${r.label}: ${r.value}`}>
              <span className="truncate text-slate-700">{r.label}</span>
              <span className="h-3 rounded-r bg-slate-100">
                <span
                  className="block h-3 rounded-r bg-brand transition-opacity group-hover:opacity-80"
                  style={{ width: `${(r.value / max) * 100}%` }}
                />
              </span>
              <span className="text-right tabular-nums text-slate-600">{r.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Where the system's count and the shelf disagreed. Large or repeated gaps point to shrinkage or mis-scans. */
function Corrections({ rows, error }: { rows: StockCorrection[] | undefined; error: unknown }) {
  const net = (rows ?? []).reduce((n, c) => n + c.delta, 0);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Stock corrections</h2>
          <p className="text-xs text-slate-500">Floor staff counted the shelf and the system was wrong. A minus means fewer on the shelf than expected.</p>
        </div>
        {rows && rows.length > 0 && (
          <p className="text-sm text-slate-600">
            {rows.length} correction{rows.length === 1 ? "" : "s"}, net <span className="font-semibold tabular-nums">{net > 0 ? `+${net}` : net}</span> units
          </p>
        )}
      </div>
      {!rows ? (
        <p className="mt-3 text-sm text-slate-500">{error ? `Could not load corrections: ${(error as Error).message}` : "Loading…"}</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No corrections in this period.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1 pr-3">Product</th>
                <th className="py-1 pr-3 text-right">System</th>
                <th className="py-1 pr-3 text-right">Counted</th>
                <th className="py-1 pr-3 text-right">Change</th>
                <th className="py-1 pr-3">Reason</th>
                <th className="py-1">By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3">{c.name}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">{c.systemQty}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{c.countedQty}</td>
                  <td className={`py-1.5 pr-3 text-right font-medium tabular-nums ${c.delta < 0 ? "text-red-700" : "text-slate-700"}`}>
                    {c.delta > 0 ? `+${c.delta}` : c.delta}
                  </td>
                  <td className="py-1.5 pr-3 text-slate-600">{c.reason}</td>
                  <td className="py-1.5 text-xs text-slate-500">
                    {c.staffName ?? "—"}
                    <span className="block">{dateTime(c.at)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
