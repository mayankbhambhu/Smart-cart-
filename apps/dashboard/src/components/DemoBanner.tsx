"use client";

import { useEffect, useState } from "react";
import { DEMO } from "@/lib/api";

/** Shown only in demo mode: explains the sample data and lets testers drive the simulation. */
export function DemoBanner() {
  const [paused, setPaused] = useState(false);
  const [store, setStore] = useState<ReturnType<typeof import("@/lib/demo/store").demoStore> | null>(null);

  useEffect(() => {
    if (!DEMO) return;
    let off = () => {};
    void import("@/lib/demo/store").then(({ demoStore }) => {
      const s = demoStore();
      setStore(s);
      setPaused(s.paused);
      off = s.onPausedChange(setPaused);
    });
    return () => off();
  }, []);

  if (!DEMO) return null;
  const button = "rounded border border-sky-300 bg-white px-2 py-0.5 text-sky-900 hover:bg-sky-100 disabled:opacity-50";
  return (
    <div className="border-b border-sky-200 bg-sky-50">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm text-sky-900">
        <span>
          <span className="font-medium">Demo mode.</span> Sample store data; shoppers are simulated in your
          browser. Nothing is saved.
        </span>
        <span className="flex flex-wrap gap-2">
          <button className={button} disabled={!store} onClick={() => store?.addShopper()}>
            Add a shopper
          </button>
          <button className={button} disabled={!store} onClick={() => store?.triggerLowStock()}>
            Trigger a low-stock alert
          </button>
          <button className={button} disabled={!store} onClick={() => store?.triggerUnscanned()}>
            Put an item in unscanned
          </button>
          <button className={button} disabled={!store} onClick={() => store?.triggerExitGate()}>
            Cart at exit unpaid
          </button>
          <button className={button} disabled={!store} onClick={() => store?.setPaused(!paused)}>
            {paused ? "Resume shoppers" : "Pause shoppers"}
          </button>
        </span>
      </div>
    </div>
  );
}
