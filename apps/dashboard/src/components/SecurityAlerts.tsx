"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { securityQuery } from "@/lib/queries";
import { alertTitle } from "@/lib/security";

/** On every page but Security: a bar while a cart needs checking and nobody has picked it up. */
export function SecurityAlerts() {
  const pathname = usePathname();
  const open = useQuery(securityQuery(true)).data?.filter((a) => a.status === "open") ?? [];
  if (open.length === 0 || pathname.startsWith("/security")) return null;
  return (
    <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm">
      <span>
        <span className="font-medium">{open.length === 1 ? "A cart needs a check" : `${open.length} carts need a check`}</span>
        <> · {alertTitle(open[0]!)}</>
      </span>
      <Link href="/security" className="shrink-0 font-medium text-red-900 underline">
        Open security
      </Link>
    </div>
  );
}
