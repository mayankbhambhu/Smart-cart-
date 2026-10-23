"use client";

import type { StaffRole } from "@smart-cart/contracts";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEMO, helpQuery } from "@/lib/api";
import { reservationsQuery, securityQuery, staffRequestsQuery } from "@/lib/queries";

const links: { href: string; label: string; admin?: boolean }[] = [
  { href: "/inventory", label: "Inventory" },
  { href: "/carts", label: "Active carts" },
  { href: "/orders", label: "Orders" },
  { href: "/reservations", label: "Reservations" },
  { href: "/offers", label: "Offers" },
  { href: "/help", label: "Help" },
  { href: "/security", label: "Security" },
  { href: "/fleet", label: "Cart fleet" },
  { href: "/tasks", label: "Staff and tasks" },
  { href: "/analytics", label: "Analytics" },
  { href: "/insights", label: "Reports" },
  { href: "/staff", label: "Staff accounts" },
  { href: "/approvals", label: "Account approvals", admin: true },
  ...(DEMO ? [{ href: "/shopper", label: "Shopper app" }] : []),
];

export function Nav({ role }: { role: StaffRole }) {
  const pathname = usePathname();
  const isAdmin = role === "admin";
  const openHelp = useQuery(helpQuery(true)).data?.filter((h) => h.status === "open").length ?? 0;
  const toPick = useQuery(reservationsQuery()).data?.filter((r) => r.status === "reserved").length ?? 0;
  const pending = useQuery({ ...staffRequestsQuery("pending"), enabled: isAdmin }).data?.length ?? 0;
  const toCheck = useQuery(securityQuery(true)).data?.filter((a) => a.status === "open").length ?? 0;
  const badge: Record<string, number> = { "/help": openHelp, "/security": toCheck, "/reservations": toPick, "/approvals": pending };

  return (
    <nav className="flex flex-wrap gap-1">
      {links
        .filter((l) => !l.admin || isAdmin)
        .map((l) => {
          const active = pathname.startsWith(l.href);
          const n = badge[l.href] ?? 0;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                active ? "bg-brand-soft text-brand" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {l.label}
              {n > 0 && (
                <span
                  className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs font-semibold text-white ${
                    l.href === "/help" ? "bg-orange-500" : l.href === "/security" ? "bg-red-600" : "bg-slate-600"
                  }`}
                >
                  {n}
                </span>
              )}
            </Link>
          );
        })}
    </nav>
  );
}
