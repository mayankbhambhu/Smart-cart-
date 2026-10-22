import type { ReactNode } from "react";

/** Shared bits for the store-team pages, in the dashboard's existing Tailwind style. */
export const inputCls = "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-brand focus:outline-none";
export const buttonCls = "rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm hover:bg-slate-50 disabled:opacity-50";
export const primaryCls = "rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";

export function PageHead({ title, hint, children }: { title: string; hint: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-slate-500">{hint}</p>
      </div>
      {children}
    </div>
  );
}

const tones = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  grey: "bg-slate-100 text-slate-600 ring-slate-200",
};
export type Tone = keyof typeof tones;

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
}

export function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="text-xs text-slate-500">{note}</p>}
    </div>
  );
}

export function Card({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      {title && <h2 className="text-sm font-semibold">{title}</h2>}
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      <div className={title || hint ? "mt-3" : ""}>{children}</div>
    </div>
  );
}

export function Notice({ tone, children }: { tone: "error" | "ok" | "info"; children: ReactNode }) {
  const cls = { error: "bg-red-50 text-red-700", ok: "bg-emerald-50 text-emerald-800", info: "bg-sky-50 text-sky-900" }[tone];
  return (
    <p className={`rounded-md p-2.5 text-sm ${cls}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

export function Loading({ error }: { error: unknown }) {
  if (error) return <Notice tone="error">Could not load this: {(error as Error).message}</Notice>;
  return <p className="text-sm text-slate-500">Loading…</p>;
}
