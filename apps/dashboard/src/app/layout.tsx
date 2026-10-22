import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { STORE_ID } from "@/lib/api";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Smart Cart · Store dashboard",
  description: "Live inventory, active carts and orders for the Smart Cart pilot store.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <Providers>
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-semibold text-brand">Smart Cart</span>
                <span className="text-sm text-slate-500">Store {STORE_ID}</span>
              </div>
              <Nav />
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
