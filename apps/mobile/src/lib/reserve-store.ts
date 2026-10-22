import type { SearchResult } from "@smart-cart/contracts";
import { create } from "zustand";
import { setQty } from "./team-logic";

type ReserveState = {
  /** What the shopper is about to reserve: product id to quantity. */
  qty: Record<string, number>;
  products: Record<string, SearchResult>;
  set: (product: SearchResult, qty: number) => void;
  clear: () => void;
};

export const useReserve = create<ReserveState>((set, get) => ({
  qty: {},
  products: {},
  set: (product, qty) =>
    set({ qty: setQty(get().qty, product.productId, qty), products: { ...get().products, [product.productId]: product } }),
  clear: () => set({ qty: {}, products: {} }),
}));
