"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { helpQuery } from "@/lib/api";

/** On every page but Help: a bar while shoppers are waiting for a floor assistant. */
export function HelpAlerts() {
  const pathname = usePathname();
  const waiting = useQuery(helpQuery(true)).data?.filter((h) => h.status === "open") ?? [];
  if (waiting.length === 0 || pathname.startsWith("/help")) return null;
  const aisles = [...new Set(waiting.map((h) => h.aisle).filter(Boolean))];
  return (
    <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm">
      <span>
        <span className="font-medium">
          {waiting.length} {waiting.length === 1 ? "shopper needs" : "shoppers need"} help
        </span>
        {aisles.length > 0 && <> · aisle {aisles.join(", ")}</>}
      </span>
      <Link href="/help" className="font-medium text-orange-900 underline">
        Open help requests
      </Link>
    </div>
  );
}
