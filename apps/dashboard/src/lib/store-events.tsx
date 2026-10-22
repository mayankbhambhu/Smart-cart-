"use client";

import type { SmartCartEvent } from "@smart-cart/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { io } from "socket.io-client";
import { API_URL, AUTH_TOKEN, DEMO, STORE_ID, type ActiveCart, type InventoryItem } from "./api";

export type Connection = "connecting" | "live" | "offline";
export type LowStockAlert = { productId: string; name: string; available: number; onHand: number; at: string };

type StoreEventsState = { connection: Connection; alerts: LowStockAlert[]; dismiss: (productId: string) => void };
const StoreEvents = createContext<StoreEventsState>({ connection: "connecting", alerts: [], dismiss: () => {} });
export const useStoreEvents = () => useContext(StoreEvents);

/**
 * One Socket.IO connection to the store room for the whole dashboard. Events patch the
 * TanStack Query cache in place, so pages render live data without polling.
 */
export function StoreEventsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<Connection>("connecting");
  const [alerts, setAlerts] = useState<LowStockAlert[]>([]);

  useEffect(() => {
    const onEvent = (event: SmartCartEvent) => {
      switch (event.type) {
        case "cart.session_started":
        case "cart.session_ended":
          void queryClient.invalidateQueries({ queryKey: ["carts", STORE_ID] });
          break;
        case "cart.item_added":
        case "cart.item_removed":
          queryClient.setQueryData<{ sessions: ActiveCart[] }>(["carts", STORE_ID], (old) =>
            old && {
              ...old,
              sessions: old.sessions.map((s) =>
                s.sessionId === event.data.sessionId ? { ...s, totals: event.data.totals } : s,
              ),
            },
          );
          break;
        case "inventory.updated":
          queryClient.setQueriesData<{ items: InventoryItem[] }>({ queryKey: ["inventory", STORE_ID] }, (old) =>
            old && {
              ...old,
              items: old.items.map((i) => {
                if (i.productId !== event.data.productId) return i;
                const available = event.data.onHand - event.data.reserved;
                return {
                  ...i,
                  onHand: event.data.onHand,
                  reserved: event.data.reserved,
                  available,
                  lowStock: available <= i.lowStockThreshold,
                };
              }),
            },
          );
          break;
        case "inventory.low_stock":
          setAlerts((a) => [
            {
              productId: event.data.productId,
              name: event.data.name,
              available: event.data.available,
              onHand: event.data.onHand,
              at: event.occurredAt,
            },
            ...a.filter((x) => x.productId !== event.data.productId),
          ]);
          break;
      }
    };

    if (DEMO) {
      let unsubscribe = () => {};
      void import("./demo/store").then(({ demoStore }) => {
        unsubscribe = demoStore().subscribe(onEvent);
        setConnection("live");
      });
      return () => unsubscribe();
    }

    const socket = io(API_URL, { auth: { token: AUTH_TOKEN }, transports: ["websocket", "polling"] });
    socket.on("connect", async () => {
      const res = await socket.emitWithAck("join", { room: "store", storeId: STORE_ID });
      setConnection(res?.ok ? "live" : "offline");
      // Anything missed while disconnected: reload from REST.
      void queryClient.invalidateQueries();
    });
    socket.on("disconnect", () => setConnection("offline"));
    socket.on("connect_error", () => setConnection("offline"));
    socket.on("event", onEvent);
    return () => {
      socket.disconnect();
    };
  }, [queryClient]);

  const dismiss = (productId: string) => setAlerts((a) => a.filter((x) => x.productId !== productId));
  return <StoreEvents.Provider value={{ connection, alerts, dismiss }}>{children}</StoreEvents.Provider>;
}
