import type { CartSnapshot, CheckoutResponse, WeightCheckStatus } from "@smart-cart/contracts";
import * as Crypto from "expo-crypto";
import { create } from "zustand";
import { api, type LineChange } from "./api";
import { tokenFor, useAuth } from "./auth-store";
import { useAssist } from "./assist-store";
import { applyEvent, withLine } from "./cart-logic";
import { connectCart } from "./realtime";
import { withRetry } from "./retry";

type CartState = {
  /** Null when the shopper has no open cart. */
  cart: CartSnapshot | null;
  /** True while the WebSocket is connected and joined to the cart room. */
  live: boolean;
  /** Set when the session ended (cancelled, abandoned, paid). */
  endedReason: string | null;
  /** The order paid for most recently, so the app can show its receipt. */
  paidOrderId: string | null;
  /** True while a scan or removal is being retried because the connection dropped. */
  retrying: boolean;
  /** The cart's last weight check, when it doesn't match what was scanned. Null while it matches. */
  weight: { status: Exclude<WeightCheckStatus, "ok" | "unknown">; diffG: number | null } | null;

  resume: () => Promise<void>;
  pair: (cartCode: string, storeId: string) => Promise<void>;
  /** A cart the server already paired, e.g. the parked cart of a collected reservation. */
  adopt: (cart: CartSnapshot) => void;
  add: (barcode: string, qty: number, requestId: string) => Promise<LineChange>;
  removeOne: (productId: string) => Promise<void>;
  removeAll: (productId: string) => Promise<void>;
  leave: () => Promise<void>;
  checkout: () => Promise<CheckoutResponse>;
  backToCart: (orderId: string) => Promise<void>;
  markPaid: (orderId: string) => void;
  reset: () => void;
};

let disconnect: (() => void) | null = null;

/**
 * The shopper's live cart. The server pushes every change over the WebSocket; REST responses
 * are applied as well so the screen updates at once even when the socket is slow.
 */
export const useCart = create<CartState>((set, get) => {
  const open = (cart: CartSnapshot) => {
    disconnect?.();
    set({ cart, live: false, endedReason: null, weight: null });
    useAssist.getState().setStoreId(cart.storeId);
    const session = useAuth.getState().session;
    if (!session) return;
    disconnect = connectCart({
      token: tokenFor(session),
      sessionId: cart.sessionId,
      onLive: (live) => set({ live }),
      onEvent: (event) => {
        const outcome = applyEvent(get().cart, event);
        if (outcome.kind === "cart") set({ cart: outcome.cart });
        if (outcome.kind === "ended") close(outcome.reason);
        if (outcome.kind === "paid") get().markPaid(outcome.orderId);
        if (outcome.kind === "help") useAssist.getState().setHelp(outcome.request);
        if (outcome.kind === "weight") {
          const off = outcome.status === "extra" || outcome.status === "missing";
          set({ weight: off ? { status: outcome.status as "extra" | "missing", diffG: outcome.diffG } : null });
        }
      },
    });
  };

  const close = (reason: string) => {
    disconnect?.();
    disconnect = null;
    set({ cart: null, live: false, endedReason: reason, weight: null });
  };

  const setStatus = (status: CartSnapshot["status"]) => {
    const cart = get().cart;
    if (cart) set({ cart: { ...cart, status } });
  };

  const applyChange = (productId: string, change: LineChange) => {
    const cart = get().cart;
    if (cart) set({ cart: withLine(cart, productId, change.line, change.totals) });
  };

  /** Retries through a dropped connection, with the caller's requestId, so each change applies once. */
  const resilient = async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await withRetry(fn, { onRetry: () => set({ retrying: true }) });
    } finally {
      set({ retrying: false });
    }
  };

  const remove = async (productId: string, qty: 1 | "all") => {
    const cart = get().cart;
    if (!cart) return;
    const requestId = Crypto.randomUUID();
    applyChange(productId, await resilient(() => api.removeItem(cart.sessionId, productId, qty, requestId)));
  };

  return {
    cart: null,
    live: false,
    endedReason: null,
    paidOrderId: null,
    weight: null,
    retrying: false,

    resume: async () => {
      const cart = await api.myCart();
      if (cart) open(cart);
    },

    pair: async (cartCode, storeId) => open(await api.pair(cartCode, storeId)),
    adopt: (cart) => open(cart),

    add: async (barcode, qty, requestId) => {
      const cart = get().cart;
      if (!cart) throw new Error("no open cart");
      const change = await resilient(() => api.addItem(cart.sessionId, barcode, qty, requestId));
      if (change.line) applyChange(change.line.productId, change);
      return change;
    },

    removeOne: (productId) => remove(productId, 1),
    removeAll: (productId) => remove(productId, "all"),

    leave: async () => {
      const cart = get().cart;
      if (!cart) return;
      await api.cancel(cart.sessionId);
      close("cancelled");
    },

    checkout: async () => {
      const cart = get().cart;
      if (!cart) throw new Error("no open cart");
      const res = await api.checkout(cart.sessionId);
      setStatus("checking_out");
      return res;
    },

    backToCart: async (orderId) => {
      await api.backToCart(orderId);
      setStatus("active");
    },

    markPaid: (orderId) => {
      if (get().cart) close("paid");
      set({ paidOrderId: orderId });
    },

    reset: () => {
      disconnect?.();
      disconnect = null;
      set({ cart: null, live: false, endedReason: null, paidOrderId: null, weight: null });
    },
  };
});
