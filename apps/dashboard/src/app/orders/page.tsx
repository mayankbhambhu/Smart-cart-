"use client";

import type { ExitCheckResponse } from "@smart-cart/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { apiGet, apiPost, DEMO, formatInr, STORE_ID, type OrderRow } from "@/lib/api";

const statusStyle: Record<OrderRow["status"], { label: string; className: string }> = {
  paid: { label: "Paid", className: "bg-brand-soft text-brand" },
  pending_payment: { label: "Paying", className: "bg-sky-100 text-sky-800" },
  cancelled: { label: "Cancelled", className: "bg-slate-100 text-slate-600" },
  refunded: { label: "Refunded", className: "bg-amber-100 text-amber-900" },
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

export default function OrdersPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["orders", STORE_ID],
    queryFn: () => apiGet<{ orders: OrderRow[] }>(`/admin/v1/stores/${STORE_ID}/orders`),
  });
  const orders = data?.orders ?? [];
  const paid = orders.filter((o) => o.status === "paid");
  const takings = paid.reduce((s, o) => s + o.totalPaise, 0);

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Orders</h1>
        <p className="text-sm text-slate-500">
          {paid.length} paid · {formatInr(takings)} taken · {paid.filter((o) => o.exitUsedAt).length} checked out at the door
        </p>
      </div>

      <ExitCheck />

      {error ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">Could not reach the API: {(error as Error).message}</p>
      ) : isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : orders.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          No orders yet. An order appears here when a shopper taps Checkout in the app.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Cart</th>
                <th className="px-3 py-2">Shopper</th>
                <th className="px-3 py-2 text-right">Items</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">GST</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Exit</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.orderId} className="border-t border-slate-100">
                  <td className="px-3 py-2 tabular-nums text-slate-600">{time(o.createdAt)}</td>
                  <td className="px-3 py-2 font-medium">{o.cartCode}</td>
                  <td className="px-3 py-2">{o.shopperName ?? "Shopper"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{o.itemCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInr(o.totalPaise)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatInr(o.taxPaise)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${statusStyle[o.status].className}`}>
                      {statusStyle[o.status].label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {o.exitUsedAt ? (
                      <span>Left at {time(o.exitUsedAt)}</span>
                    ) : o.exitCode ? (
                      <span className="font-mono tracking-wider">{o.exitCode}</span>
                    ) : (
                      "—"
                    )}
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

const results: Record<ExitCheckResponse["result"], { title: string; className: string }> = {
  ok: { title: "Paid. Let the shopper through.", className: "border-emerald-300 bg-emerald-50 text-emerald-900" },
  already_used: { title: "This code was already used at the exit.", className: "border-amber-300 bg-amber-50 text-amber-900" },
  not_paid: { title: "This order is not paid.", className: "border-red-300 bg-red-50 text-red-800" },
  not_found: { title: "No order with this code in this store.", className: "border-red-300 bg-red-50 text-red-800" },
};

/** Door check: staff type the shopper's code (or scan the exit QR with a USB scanner). */
function ExitCheck() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExitCheckResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [demoCode, setDemoCode] = useState<string | null>(null);

  // Demo mode: offer a real code from a simulated receipt so the check can be tried.
  useEffect(() => {
    if (!DEMO) return;
    void import("@/lib/demo/store").then(({ demoStore }) => setDemoCode(demoStore().unusedExitCode()));
  }, [result]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 4) return;
    setBusy(true);
    setFailed(false);
    try {
      setResult(await apiPost<ExitCheckResponse>(`/admin/v1/stores/${STORE_ID}/exit-checks`, { code: code.trim() }));
      setCode("");
      void queryClient.invalidateQueries({ queryKey: ["orders", STORE_ID] });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const r = result && results[result.result];
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <label htmlFor="exit-code" className="text-sm font-medium text-slate-700">
          Exit check
        </label>
        <input
          id="exit-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Code from the shopper's receipt"
          autoComplete="off"
          className="w-64 rounded-md border border-slate-300 px-3 py-1.5 font-mono text-sm uppercase tracking-wider placeholder:font-sans placeholder:normal-case placeholder:tracking-normal"
        />
        <button
          type="submit"
          disabled={busy || code.trim().length < 4}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Check
        </button>
      </form>
      {demoCode && (
        <p className="text-xs text-slate-500">
          Demo: a shopper is at the door with code{" "}
          <button type="button" className="font-mono tracking-wider text-brand underline" onClick={() => setCode(demoCode)}>
            {demoCode}
          </button>
        </p>
      )}
      {failed && <p className="text-sm text-red-700">Could not check the code. Try again.</p>}
      {r && result && (
        <div className={`rounded-md border px-3 py-2 text-sm ${r.className}`} role="status">
          <p className="font-medium">{result.bagCheck ? "Paid. Check the bag before they leave." : r.title}</p>
          {result.order && (
            <p>
              Cart {result.order.cartCode} · {result.order.totals.itemCount} items · {formatInr(result.order.totals.totalPaise)}
              {result.order.exitUsedAt && result.result === "already_used" ? ` · first used at ${time(result.order.exitUsedAt)}` : ""}
            </p>
          )}
        </div>
      )}
      {result?.bagCheck && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="alert">
          <p className="font-medium">Why</p>
          <p>{result.bagCheck.reason}</p>
          <p className="text-xs text-amber-900">
            Ask politely; it is usually a shopper's own item or a scale that needs recalibrating. Close the alert on the{" "}
            <Link href="/security" className="underline">
              Security
            </Link>{" "}
            page once done.
          </p>
        </div>
      )}
    </div>
  );
}
