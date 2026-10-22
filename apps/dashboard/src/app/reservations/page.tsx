"use client";

import type { Reservation, ReservationStatus } from "@smart-cart/contracts";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Badge, Loading, PageHead, Tile, type Tone } from "@/components/ui";
import { formatInr } from "@/lib/api";
import { reservationsQuery } from "@/lib/queries";
import { slotLabel, time } from "@/lib/team";

const status: Record<ReservationStatus, { label: string; tone: Tone }> = {
  reserved: { label: "To pick", tone: "amber" },
  picked: { label: "Ready in cart", tone: "green" },
  collected: { label: "Collected", tone: "blue" },
  expired: { label: "Expired", tone: "grey" },
  cancelled: { label: "Cancelled", tone: "grey" },
};

/** Shoppers' unpaid holds for a pickup slot. Floor staff pick them on the handheld into a parked cart. */
export default function ReservationsPage() {
  const { data, error } = useQuery(reservationsQuery());
  const [showClosed, setShowClosed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  if (!data) return <Loading error={error} />;
  const count = (s: ReservationStatus) => data.filter((r) => r.status === s).length;
  const rows = data.filter((r) => showClosed || r.status === "reserved" || r.status === "picked");
  const late = (r: Reservation) => r.status === "reserved" && Date.parse(r.slotStart) < Date.now();

  return (
    <section className="space-y-5">
      <PageHead title="Reservations" hint="Unpaid holds for a pickup slot. Stock stays held until collected, cancelled, or an hour after the slot ends.">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Show collected, expired and cancelled
        </label>
      </PageHead>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="To pick" value={String(count("reserved"))} note={`${data.filter(late).length} past their slot start`} />
        <Tile label="Ready in a cart" value={String(count("picked"))} note="parked at the pickup point" />
        <Tile label="Collected" value={String(count("collected"))} note="last 24 hours" />
        <Tile label="Expired or cancelled" value={String(count("expired") + count("cancelled"))} note="last 24 hours" />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Pickup slot</th>
              <th className="px-3 py-2">Shopper</th>
              <th className="px-3 py-2">Items</th>
              <th className="px-3 py-2 text-right">Value</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Cart</th>
              <th className="px-3 py-2">Picked by</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  No open reservations. They appear here as shoppers reserve in the app.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr className="border-t border-slate-100 align-top hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2">
                    {slotLabel(r.slotStart, r.slotEnd)}
                    {late(r) && <span className="ml-2 text-xs font-medium text-red-600">late</span>}
                  </td>
                  <td className="px-3 py-2">{r.shopperName ?? "Shopper"}</td>
                  <td className="px-3 py-2">
                    <button className="text-brand underline-offset-2 hover:underline" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                      {r.itemCount} item{r.itemCount === 1 ? "" : "s"} {open === r.id ? "▴" : "▾"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInr(r.totalPaise)}</td>
                  <td className="px-3 py-2">
                    <Badge tone={status[r.status].tone}>{status[r.status].label}</Badge>
                  </td>
                  <td className="px-3 py-2 font-mono">{r.cartCode ?? "—"}</td>
                  <td className="px-3 py-2">
                    {r.pickedBy ?? "—"}
                    {r.pickedAt && <span className="block text-xs text-slate-500">{time(r.pickedAt)}</span>}
                  </td>
                </tr>
                {open === r.id && (
                  <tr className="bg-slate-50">
                    <td colSpan={7} className="px-3 pb-3">
                      <ul className="grid gap-1 sm:grid-cols-2">
                        {r.items.map((i) => (
                          <li key={i.productId} className="flex justify-between gap-2 rounded bg-white px-2 py-1 ring-1 ring-slate-200">
                            <span>
                              {i.qty} × {i.name}
                            </span>
                            <span className="whitespace-nowrap text-xs text-slate-500">
                              Aisle {i.aisle ?? "?"}
                              {i.shelf && `, ${i.shelf}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
