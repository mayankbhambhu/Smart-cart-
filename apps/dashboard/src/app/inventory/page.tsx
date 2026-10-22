"use client";

import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { apiGet, formatInr, STORE_ID, type InventoryItem } from "@/lib/api";

export default function InventoryPage() {
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const q = useDeferredValue(search.trim());

  const { data, isLoading, error } = useQuery({
    queryKey: ["inventory", STORE_ID, q, lowOnly],
    queryFn: () => {
      const params = new URLSearchParams({ lowStockOnly: String(lowOnly) });
      if (q) params.set("q", q);
      return apiGet<{ items: InventoryItem[] }>(`/admin/v1/stores/${STORE_ID}/inventory?${params}`);
    },
  });

  const items = data?.items ?? [];
  const lowCount = items.filter((i) => i.lowStock).length;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Inventory</h1>
          <p className="text-sm text-slate-500">
            {items.length} products{lowCount > 0 && !lowOnly ? ` · ${lowCount} low on stock` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products"
            className="w-56 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
          />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
            Low stock only
          </label>
        </div>
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          Could not reach the API: {(error as Error).message}
        </p>
      ) : isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Aisle</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">On hand</th>
                <th className="px-3 py-2 text-right">Reserved</th>
                <th className="px-3 py-2 text-right">Threshold</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.productId} className={`border-t border-slate-100 ${i.lowStock ? "bg-amber-50" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{i.name}</div>
                    <div className="text-xs text-slate-500">
                      {i.category} · {i.barcode}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {i.aisle ?? "—"}
                    {i.shelf ? `-${i.shelf}` : ""}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInr(i.pricePaise)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {i.onHand}
                    {i.lowStock && (
                      <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                        Low
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{i.reserved}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{i.lowStockThreshold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
