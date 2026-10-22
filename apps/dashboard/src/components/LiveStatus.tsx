"use client";

import { useStoreEvents } from "@/lib/store-events";

const styles = {
  live: { dot: "bg-emerald-500", label: "Live" },
  connecting: { dot: "bg-slate-400", label: "Connecting" },
  offline: { dot: "bg-red-500", label: "Offline" },
};

export function LiveStatus() {
  const { connection } = useStoreEvents();
  const s = styles[connection];
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500" aria-live="polite">
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
