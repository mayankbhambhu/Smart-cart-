"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEMO, helpQuery } from "@/lib/api";

const links = [
  { href: "/inventory", label: "Inventory" },
  { href: "/carts", label: "Active carts" },
  { href: "/orders", label: "Orders" },
  { href: "/help", label: "Help" },
  { href: "/insights", label: "Insights" },
  ...(DEMO ? [{ href: "/shopper", label: "Shopper app" }] : []),
];

export function Nav() {
  const pathname = usePathname();
  const open = useQuery(helpQuery(true)).data?.filter((h) => h.status === "open").length ?? 0;
  return (
    <nav className="flex flex-wrap gap-1">
      {links.map((l) => {
        const active = pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              active ? "bg-brand-soft text-brand" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {l.label}
            {l.href === "/help" && open > 0 && (
              <span className="ml-1.5 rounded-full bg-orange-500 px-1.5 py-0.5 text-xs font-semibold text-white">{open}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
