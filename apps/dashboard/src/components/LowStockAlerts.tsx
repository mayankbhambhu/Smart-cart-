"use client";

import { useStoreEvents } from "@/lib/store-events";

/** Low-stock alerts raised while the dashboard is open. */
export function LowStockAlerts() {
  const { alerts, dismiss } = useStoreEvents();
  if (alerts.length === 0) return null;
  return (
    <div className="mb-4 space-y-2" role="status">
      {alerts.map((a) => (
        <div
          key={a.productId}
          className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm"
        >
          <span>
            <span className="font-medium">Restock needed:</span> {a.name} has {a.available} left for new shoppers ({a.onHand} on hand, {a.onHand - a.available} in carts).
          </span>
          <button className="text-amber-900 underline" onClick={() => dismiss(a.productId)}>
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
