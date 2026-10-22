import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DemoBanner } from "@/components/DemoBanner";
import { Shell } from "@/components/Shell";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Smart Cart · Store dashboard",
  description: "Live inventory, carts, orders, reservations, floor help, staff and reports for the Smart Cart pilot store.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <Providers>
          <DemoBanner />
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
