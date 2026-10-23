"use client";

import type { DealUplift, StoreAnalytics } from "@smart-cart/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { BarList, ChartCard, ColumnChart } from "@/components/charts";
import { apiGet, DEMO, formatInr, STORE_ID } from "@/lib/api";

const PERIODS = [1, 7, 14, 30];
const inr0 = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
const inrCompact = (rupees: number) =>
  "₹" + new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(rupees);
const pct = (share: number | null) => (share === null ? "—" : `${Math.round(share * 100)}%`);
const hourLabel = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);
const hourRange = (h: number) => `${hourLabel(h)}–${hourLabel((h + 1) % 24)}`;
const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", timeZone: "Asia/Kolkata" });
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/**
 * Store analytics for the pilot review: when the store is busy, what baskets look like, whether deals
 * moved stock, how shoppers use voice search, which aisles are busiest, and what the cart alerts did.
 * The API computes all of it in Python from what the store recorded.
 */
export default function AnalyticsPage() {
  const [days, setDays] = useState(7);
  const { data, isLoading, error } = useQuery({
    queryKey: ["analytics", STORE_ID, days],
    queryFn: () => apiGet<StoreAnalytics>(`/admin/v1/stores/${STORE_ID}/analytics?days=${days}`),
  });

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Analytics</h1>
          <p className="max-w-3xl text-sm text-slate-500">
            From paid orders, the carts' scans, searches, help requests and cart alerts. Times are IST.
            {DEMO && " In this demo, two weeks of sample trading come before today's simulated shoppers."}
          </p>
        </div>
        <div className="flex gap-1 rounded-md border border-slate-200 bg-white p-0.5 text-sm" role="group" aria-label="Period">
          {PERIODS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              className={`rounded px-2.5 py-1 ${days === d ? "bg-brand-soft font-medium text-brand" : "text-slate-600"}`}
            >
              {d === 1 ? "Last 24 h" : `${d} days`}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">Could not reach the API: {(error as Error).message}</p>
      ) : isLoading || !data ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <Report a={data} />
      )}
    </section>
  );
}

function Report({ a }: { a: StoreAnalytics }) {
  const s = a.summary;
  // Store hours, widened if anything sold outside them.
  const sold = a.byHour.filter((h) => h.orders > 0).map((h) => h.hour);
  const first = Math.min(8, ...sold);
  const last = Math.max(21, ...sold);
  const hours = a.byHour.filter((h) => h.hour >= first && h.hour <= last);
  const peakHour = hours.reduce((m, h) => (h.orders > m.orders ? h : m), hours[0]!);
  const peakDay = a.byDay.reduce((m, d) => (d.revenuePaise > m.revenuePaise ? d : m), a.byDay[0]!);
  const topQty = a.topProducts[0]?.qty ?? 0;

  return (
    <>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Paid orders" value={s.orders.toLocaleString("en-IN")} />
        <Stat label="Sales" value={inr0(s.revenuePaise)} />
        <Stat label="Average basket" value={s.avgBasketPaise === null ? "—" : inr0(s.avgBasketPaise)} />
        <Stat label="Items per basket" value={s.avgItems?.toString() ?? "—"} />
        <Stat label="Pairing to paid" value={s.medianMinutesToPay === null ? "—" : `${s.medianMinutesToPay} min`} note="median" />
        <Stat label="Baskets with a deal" value={pct(a.deals.dealShare)} note={`${formatInr(a.deals.savingsPaise)} saved`} />
      </dl>

      {s.orders === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          No paid orders in this period yet. Charts appear once shoppers start paying in the app.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Orders by hour"
            subtitle={`Busiest: ${hourRange(peakHour.hour)}, ${peakHour.orders} orders`}
            chart={
              <ColumnChart
                highlight={String(peakHour.hour)}
                columns={hours.map((h) => ({
                  key: String(h.hour),
                  label: hourLabel(h.hour),
                  value: h.orders,
                  aria: `${hourRange(h.hour)}: ${h.orders} orders, ${inr0(h.revenuePaise)}`,
                  tip: <Tip title={hourRange(h.hour)} lines={[`${h.orders} orders`, inr0(h.revenuePaise)]} />,
                }))}
              />
            }
            table={{ head: ["Hour", "Orders", "Sales"], rows: hours.map((h) => [hourRange(h.hour), h.orders, inr0(h.revenuePaise)]) }}
          />
          <ChartCard
            title="Sales by day"
            subtitle={`Best: ${dayLabel(peakDay.date)}, ${inr0(peakDay.revenuePaise)}`}
            chart={
              <ColumnChart
                format={(n) => inrCompact(n)}
                highlight={peakDay.date}
                columns={a.byDay.map((d) => ({
                  key: d.date,
                  label: a.byDay.length > 8 ? String(Number(d.date.slice(8))) : dayLabel(d.date),
                  value: Math.round(d.revenuePaise / 100),
                  aria: `${dayLabel(d.date)}: ${inr0(d.revenuePaise)} from ${d.orders} orders`,
                  tip: <Tip title={dayLabel(d.date)} lines={[inr0(d.revenuePaise), `${d.orders} orders`]} />,
                }))}
              />
            }
            table={{ head: ["Day", "Orders", "Sales"], rows: a.byDay.map((d) => [dayLabel(d.date), d.orders, inr0(d.revenuePaise)]) }}
          />
          <ChartCard
            title="Top products"
            subtitle="By units sold"
            chart={
              <BarList
                bars={a.topProducts.map((p) => ({
                  key: p.productId,
                  label: p.name,
                  value: p.qty,
                  text: `${p.qty}`,
                  note: inr0(p.revenuePaise),
                }))}
              />
            }
            table={{ head: ["Product", "Units", "Sales"], rows: a.topProducts.map((p) => [p.name, p.qty, inr0(p.revenuePaise)]) }}
          />
          <ChartCard
            title="Sales by section"
            subtitle="Share of sales"
            chart={
              <BarList
                bars={a.categoryMix.slice(0, 10).map((c) => ({ key: c.section, label: c.section, value: c.share, text: pct(c.share) }))}
              />
            }
            table={{ head: ["Section", "Share", "Sales"], rows: a.categoryMix.map((c) => [c.section, pct(c.share), inr0(c.revenuePaise)]) }}
          />
        </div>
      )}

      <Deals offers={a.deals.offers} units={a.deals.dealUnits} />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Busiest aisles"
          subtitle="Items scanned into carts there, and help requests from there"
          chart={
            a.busyAisles.length ? (
              <BarList
                bars={a.busyAisles.map((x) => ({
                  key: x.aisle,
                  label: `Aisle ${x.aisle}`,
                  value: x.scans,
                  text: x.scans.toLocaleString("en-IN"),
                  note: x.helpRequests ? `${x.helpRequests} help` : undefined,
                }))}
              />
            ) : (
              <p className="text-sm text-slate-500">No scans in this period.</p>
            )
          }
          table={{ head: ["Aisle", "Scans", "Help"], rows: a.busyAisles.map((x) => [x.aisle, x.scans, x.helpRequests]) }}
        />
        <div className="grid gap-4">
          <Panel title="Searches and voice">
            <dl className="grid grid-cols-3 gap-3">
              <Stat label="Searches" value={a.searches.total.toLocaleString("en-IN")} flat />
              <Stat label="Spoken" value={pct(a.searches.voiceShare)} note={`${a.searches.voice} by voice`} flat />
              <Stat label="Not found" value={a.searches.missed.toLocaleString("en-IN")} note="see Reports" flat />
            </dl>
          </Panel>
          <Panel title="Cart alerts">
            <dl className="grid grid-cols-3 gap-3">
              <Stat label="Raised" value={String(a.security.total)} note={`${a.security.exitUnpaid} at the exit`} flat />
              <Stat label="Shopper scanned it" value={String(a.security.clearedByShopper)} note="after the nudge" flat />
              <Stat
                label="Staff checked"
                value={String(a.security.checkedByStaff)}
                note={`${a.security.falseAlarms} false alarm${a.security.falseAlarms === 1 ? "" : "s"}`}
                flat
              />
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Deals({ offers, units }: { offers: DealUplift[]; units: number }) {
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h2 className="font-semibold">Deals</h2>
        <p className="text-xs text-slate-500">
          {units.toLocaleString("en-IN")} units sold on offer. Each offer is compared with the same number of days just
          before it started; with too little to compare, it says so instead of guessing.
        </p>
      </div>
      {offers.length === 0 ? (
        <p className="text-sm text-slate-500">No offers ran in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1.5">Offer</th>
                <th className="py-1.5">When</th>
                <th className="py-1.5 text-right">Units a day before</th>
                <th className="py-1.5 text-right">During</th>
                <th className="py-1.5 text-right">Change</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.offerId} className="border-t border-slate-100">
                  <td className="py-1.5">
                    <span className="font-medium">{o.title}</span>
                    <span className="block text-xs text-slate-500">{o.name}</span>
                  </td>
                  <td className="py-1.5 text-slate-600">
                    {shortDate(o.startsAt)} to {shortDate(o.endsAt)}
                    {o.running && <span className="ml-1 rounded bg-brand-soft px-1 text-xs text-brand">running</span>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{o.unitsPerDayBefore ?? "—"}</td>
                  <td className="py-1.5 text-right tabular-nums">{o.unitsPerDayDuring}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {o.upliftPct === null ? (
                      <span className="text-xs text-slate-500">
                        {o.running && Date.now() - Date.parse(o.startsAt) < 86_400_000 ? "Too early to tell" : "Not enough sales to compare"}
                      </span>
                    ) : (
                      <span className="font-medium">
                        {o.upliftPct > 0 ? "▲ +" : o.upliftPct < 0 ? "▼ " : ""}
                        {o.upliftPct}%
                      </span>
                    )}
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

function Stat({ label, value, note, flat }: { label: string; value: string; note?: string; flat?: boolean }) {
  return (
    <div className={flat ? "" : "rounded-lg border border-slate-200 bg-white p-3"}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
      {note && <dd className="text-xs text-slate-500">{note}</dd>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Tip({ title, lines }: { title: string; lines: string[] }) {
  return (
    <>
      <p className="font-medium text-slate-900">{title}</p>
      {lines.map((l) => (
        <p key={l} className="whitespace-nowrap tabular-nums text-slate-600">
          {l}
        </p>
      ))}
    </>
  );
}
