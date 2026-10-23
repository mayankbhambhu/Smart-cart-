"use client";

import { useState, type ReactNode } from "react";

/**
 * Small single-series charts for the Analytics page, in plain HTML: one brand hue, columns at most
 * 24px wide with a 4px rounded cap on a single baseline, hairline gridlines, a tooltip on hover or
 * keyboard focus, and the same numbers available as a table.
 */

/** Rounds the top of the axis up to a clean number: 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

const compact = (n: number) => new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export type Column = { key: string; label: string; value: number; tip: ReactNode; aria: string };

export function ColumnChart({
  columns,
  format = compact,
  highlight,
  height = 160,
}: {
  columns: Column[];
  format?: (n: number) => string;
  /** The column to label directly, usually the peak. */
  highlight?: string;
  height?: number;
}) {
  const [active, setActive] = useState<string | null>(null);
  const max = niceMax(Math.max(...columns.map((c) => c.value)));
  const ticks = [0, max / 2, max];
  const shown = columns.find((c) => c.key === active);
  // Label every column's axis only when there's room; otherwise every other one.
  const step = columns.length > 16 ? 2 : 1;

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative w-10 shrink-0 text-right text-[11px] tabular-nums text-slate-400" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 translate-y-1/2 leading-none" style={{ bottom: `${(t / max) * 100}%` }}>
              {format(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="absolute inset-x-0 top-0" style={{ height }}>
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t border-slate-200" style={{ bottom: `${(t / max) * 100}%` }} />
            ))}
          </div>
          <div className="relative flex items-end" style={{ height }} onMouseLeave={() => setActive(null)}>
            {columns.map((c) => {
              const h = (c.value / max) * 100;
              return (
                <div
                  key={c.key}
                  tabIndex={0}
                  role="img"
                  aria-label={c.aria}
                  onMouseEnter={() => setActive(c.key)}
                  onFocus={() => setActive(c.key)}
                  onBlur={() => setActive(null)}
                  className="group relative flex h-full flex-1 items-end justify-center outline-none"
                >
                  {c.key === highlight && c.value > 0 && (
                    <span
                      className="absolute text-[11px] font-medium tabular-nums text-slate-700"
                      style={{ bottom: `calc(${h}% + 4px)` }}
                    >
                      {format(c.value)}
                    </span>
                  )}
                  <div
                    className={`w-[70%] max-w-6 rounded-t bg-brand transition-opacity ${
                      active && active !== c.key ? "opacity-40" : ""
                    } group-focus-visible:ring-2 group-focus-visible:ring-brand group-focus-visible:ring-offset-2`}
                    style={{ height: `${h}%`, minHeight: c.value > 0 ? 2 : 0 }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex text-[11px] text-slate-500">
            {columns.map((c, i) => (
              <span key={c.key} className="flex-1 truncate text-center">
                {i % step === 0 ? c.label : ""}
              </span>
            ))}
          </div>
          {shown && (
            <div
              role="status"
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
              style={{ left: `${((columns.indexOf(shown) + 0.5) / columns.length) * 100}%` }}
            >
              {shown.tip}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export type Bar = { key: string; label: ReactNode; value: number; text: string; note?: ReactNode };

/** Horizontal bars, longest first, with the value at each bar's tip. */
export function BarList({ bars }: { bars: Bar[] }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <ul className="space-y-2">
      {bars.map((b) => (
        <li key={b.key} className="grid grid-cols-[minmax(0,10rem)_1fr] items-center gap-3 text-sm sm:grid-cols-[minmax(0,14rem)_1fr]">
          <span className="truncate text-slate-700" title={typeof b.label === "string" ? b.label : undefined}>
            {b.label}
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-3 rounded-r bg-brand" style={{ width: `${Math.max(1, (b.value / max) * 80)}%` }} />
            <span className="shrink-0 tabular-nums text-slate-700">{b.text}</span>
            {b.note && <span className="shrink-0 text-xs text-slate-500">{b.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A chart with a "Show table" switch, so every number is readable without the chart. */
export function ChartCard({
  title,
  subtitle,
  chart,
  table,
}: {
  title: string;
  subtitle?: string;
  chart: ReactNode;
  table?: { head: string[]; rows: (string | number)[][] };
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div className="min-w-0 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {table && (
          <button onClick={() => setAsTable(!asTable)} className="shrink-0 text-xs font-medium text-brand underline">
            {asTable ? "Show chart" : "Show table"}
          </button>
        )}
      </div>
      {asTable && table ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {table.head.map((h, i) => (
                  <th key={h} className={`py-1 ${i ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={String(r[0])} className="border-t border-slate-100">
                  {r.map((v, i) => (
                    <td key={i} className={`py-1 ${i ? "text-right tabular-nums" : ""}`}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        chart
      )}
    </div>
  );
}
