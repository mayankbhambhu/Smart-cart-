"use client";

import type { FoodType, SectionsResponse } from "@smart-cart/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { FoodMark, foodTypeLabel } from "@/components/FoodMark";
import { apiGet, apiPatch, formatInr, STORE_ID, type InventoryItem } from "@/lib/api";

export default function InventoryPage() {
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [section, setSection] = useState("");
  const q = useDeferredValue(search.trim());

  const { data, isLoading, error } = useQuery({
    queryKey: ["inventory", STORE_ID, q, lowOnly],
    queryFn: () => {
      const params = new URLSearchParams({ lowStockOnly: String(lowOnly) });
      if (q) params.set("q", q);
      return apiGet<{ items: InventoryItem[] }>(`/admin/v1/stores/${STORE_ID}/inventory?${params}`);
    },
  });

  const sections = useQuery({
    queryKey: ["sections", STORE_ID],
    queryFn: () => apiGet<SectionsResponse>(`/v1/sections?storeId=${STORE_ID}`),
    staleTime: Infinity,
  });
  const items = (data?.items ?? []).filter((i) => !section || i.section === section);
  const unlabelled = items.filter((i) => i.foodType === null).length;
  const lowCount = items.filter((i) => i.lowStock).length;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Inventory</h1>
          <p className="text-sm text-slate-500">
            {items.length} products{lowCount > 0 && !lowOnly ? ` · ${lowCount} low on stock` : ""}
            {unlabelled > 0 && ` · ${unlabelled} without a food label`}
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
          <select
            aria-label="Section"
            value={section}
            onChange={(e) => setSection(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">All sections</option>
            {sections.data?.sections.map((s) => (
              <option key={s.id} value={s.name}>
                {s.icon} {s.name}
              </option>
            ))}
          </select>
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
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Food label</th>
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
                      {i.section ? `${i.section} › ${i.category}` : i.category} · {i.barcode}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <LabelCell item={i} />
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

/** Managers correct a food label from the pack. Every change is kept in the audit log. */
function LabelCell({ item }: { item: InventoryItem }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const save = useMutation({
    mutationFn: (foodType: FoodType | null) =>
      apiPatch(`/admin/v1/stores/${STORE_ID}/catalog/products/${item.productId}`, { foodType }),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ["inventory", STORE_ID] });
    },
  });
  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="rounded px-1 py-0.5 hover:bg-slate-100" title="Change the food label">
        <FoodMark type={item.foodType} />
      </button>
    );
  }
  return (
    <select
      autoFocus
      aria-label={`Food label for ${item.name}`}
      className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs"
      defaultValue={item.foodType ?? ""}
      disabled={save.isPending}
      onBlur={() => !save.isPending && setEditing(false)}
      onChange={(e) => save.mutate((e.target.value || null) as FoodType | null)}
    >
      <option value="">Not labelled</option>
      {(Object.keys(foodTypeLabel) as FoodType[]).map((t) => (
        <option key={t} value={t}>
          {foodTypeLabel[t]}
        </option>
      ))}
    </select>
  );
}
