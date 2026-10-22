"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { SessionProvider } from "@/lib/session";
import { StoreEventsProvider } from "@/lib/store-events";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }));
  return (
    <QueryClientProvider client={client}>
      <SessionProvider>
        <StoreEventsProvider>{children}</StoreEventsProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
